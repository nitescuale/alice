"""Client async pour l'API Podcast Index (auth HMAC-SHA1 sur header).

Doc : https://podcastindex-org.github.io/docs-api/
Sert à retrouver le flux RSS d'un show et l'enclosure URL d'un épisode
à partir de métadonnées Spotify.
"""

from __future__ import annotations

import hashlib
import time
import unicodedata
from typing import Any

import httpx

from . import config

_PI_BASE = "https://api.podcastindex.org/api/1.0"


def _auth_headers() -> dict[str, str]:
    key, secret = config.get_podcast_index_creds()
    if not key or not secret:
        raise RuntimeError(
            "Credentials Podcast Index manquants. Configure PODCAST_INDEX_KEY et "
            "PODCAST_INDEX_SECRET dans Settings."
        )
    epoch = str(int(time.time()))
    digest = hashlib.sha1((key + secret + epoch).encode("utf-8")).hexdigest()
    return {
        "User-Agent": "ALICE-Podcasts/1.0",
        "X-Auth-Date": epoch,
        "X-Auth-Key": key,
        "Authorization": digest,
    }


def _normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return "".join(ch for ch in s.lower() if ch.isalnum() or ch.isspace()).strip()


async def search_show(name: str) -> list[dict[str, Any]]:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_PI_BASE}/search/byterm",
            params={"q": name, "max": 20},
            headers=_auth_headers(),
            timeout=20.0,
        )
        r.raise_for_status()
        return r.json().get("feeds", []) or []


async def get_episodes_by_feed_id(feed_id: int, max_items: int = 1000) -> list[dict[str, Any]]:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_PI_BASE}/episodes/byfeedid",
            params={"id": feed_id, "max": max_items},
            headers=_auth_headers(),
            timeout=30.0,
        )
        r.raise_for_status()
        return r.json().get("items", []) or []


def _best_show(shows: list[dict[str, Any]], target_name: str) -> dict[str, Any] | None:
    if not shows:
        return None
    target = _normalize(target_name)
    exact = [s for s in shows if _normalize(s.get("title", "")) == target]
    if exact:
        return exact[0]
    contains = [s for s in shows if target and target in _normalize(s.get("title", ""))]
    if contains:
        return contains[0]
    return shows[0]


def _best_episode(
    episodes: list[dict[str, Any]],
    target_title: str,
    target_release_date: str,
    target_duration_ms: int,
) -> dict[str, Any] | None:
    if not episodes:
        return None
    target_t = _normalize(target_title)
    target_dur = target_duration_ms / 1000.0 if target_duration_ms else 0.0

    target_ts = 0
    if target_release_date:
        try:
            t = time.strptime(target_release_date, "%Y-%m-%d")
            target_ts = int(time.mktime(t))
        except ValueError:
            pass

    def score(ep: dict[str, Any]) -> float:
        title = _normalize(ep.get("title", ""))
        s = 0.0
        if title == target_t:
            s += 100
        elif target_t and target_t in title:
            s += 50
        elif title and title in target_t:
            s += 30
        if target_ts:
            ep_ts = int(ep.get("datePublished", 0))
            if ep_ts:
                delta_days = abs(ep_ts - target_ts) / 86400
                if delta_days <= 1:
                    s += 40
                elif delta_days <= 7:
                    s += 20
                elif delta_days <= 30:
                    s += 5
        if target_dur:
            ep_dur = float(ep.get("duration", 0))
            if ep_dur:
                rel = abs(ep_dur - target_dur) / max(target_dur, 1)
                if rel < 0.05:
                    s += 30
                elif rel < 0.15:
                    s += 10
        return s

    ranked = sorted(episodes, key=score, reverse=True)
    top = ranked[0]
    if score(top) <= 0:
        return None
    return top


async def resolve_spotify_episode(sp_meta: dict[str, Any]) -> dict[str, Any] | None:
    """Étant donné des métadonnées Spotify, retourne l'épisode Podcast Index match (ou None)."""
    show_name = sp_meta.get("show_name", "")
    if not show_name:
        return None
    shows = await search_show(show_name)
    show = _best_show(shows, show_name)
    if not show:
        return None
    feed_id = int(show["id"])
    episodes = await get_episodes_by_feed_id(feed_id)
    return _best_episode(
        episodes,
        sp_meta.get("name", ""),
        sp_meta.get("release_date", ""),
        int(sp_meta.get("duration_ms", 0)),
    )
