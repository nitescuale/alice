"""Spotify Web API minimal wrapper (Client Credentials flow).

Lit uniquement les métadonnées d'un épisode pour pouvoir matcher contre
Podcast Index. Aucune lecture audio.
"""

from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from . import config

_SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
_SPOTIFY_API_BASE = "https://api.spotify.com/v1"

_token_cache: dict[str, Any] = {"access_token": None, "expires_at": 0.0}


def extract_episode_id(url: str) -> str:
    """Récupère l'episode_id depuis une URL Spotify ou un URI."""
    s = url.strip()
    m = re.search(r"spotify[:/]+episode[:/]+([A-Za-z0-9]+)", s)
    if m:
        return m.group(1)
    parsed = urlparse(s)
    if parsed.netloc.endswith("spotify.com") and "/episode/" in parsed.path:
        return parsed.path.rsplit("/episode/", 1)[1].split("/")[0].split("?")[0]
    raise ValueError(f"URL Spotify invalide : {url}")


async def _get_token(client: httpx.AsyncClient) -> str:
    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now + 30:
        return _token_cache["access_token"]
    cid, secret = config.get_spotify_creds()
    if not cid or not secret:
        raise RuntimeError(
            "Credentials Spotify manquants. Configure SPOTIFY_CLIENT_ID et "
            "SPOTIFY_CLIENT_SECRET dans Settings."
        )
    r = await client.post(
        _SPOTIFY_TOKEN_URL,
        data={"grant_type": "client_credentials"},
        auth=(cid, secret),
        timeout=20.0,
    )
    r.raise_for_status()
    data = r.json()
    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = now + float(data.get("expires_in", 3600))
    return _token_cache["access_token"]


async def get_episode(episode_id: str, market: str = "US") -> dict[str, Any]:
    """Retourne {id, name, show_name, duration_ms, release_date, language}."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        r = await client.get(
            f"{_SPOTIFY_API_BASE}/episodes/{episode_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={"market": market},
            timeout=20.0,
        )
        if r.status_code == 404:
            raise RuntimeError(f"Épisode Spotify introuvable : {episode_id}")
        r.raise_for_status()
        ep = r.json()
        return {
            "id": ep["id"],
            "name": ep["name"],
            "show_name": (ep.get("show") or {}).get("name", ""),
            "show_publisher": (ep.get("show") or {}).get("publisher", ""),
            "duration_ms": int(ep.get("duration_ms", 0)),
            "release_date": ep.get("release_date", ""),
            "language": ep.get("language", ""),
            "external_url": (ep.get("external_urls") or {}).get("spotify", ""),
        }
