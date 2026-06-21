"""YouTube ingestion via yt-dlp.

Mirrors the surface of ``spotify_client`` + ``podcast_index`` (metadata fetch +
audio enclosure) so the rest of the pipeline can treat a YouTube video like any
podcast episode. ffmpeg must be on PATH (already required by Groq / cleanup).
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any, Callable

import httpx
import yt_dlp

logger = logging.getLogger(__name__)

# Accept the half-dozen YouTube hostnames + share-shortened form.
_YT_HOST_RE = re.compile(
    r"^(?:https?://)?"
    r"(?:www\.|m\.|music\.)?"
    r"(?:youtube\.com|youtu\.be)"
    r"(?:/|$)",
    re.IGNORECASE,
)

_YT_ID_RE = re.compile(r"(?:v=|/shorts/|youtu\.be/|/embed/|/v/)([A-Za-z0-9_-]{11})")


def is_youtube_url(url: str) -> bool:
    return bool(_YT_HOST_RE.match(url.strip()))


def extract_video_id(url: str) -> str:
    m = _YT_ID_RE.search(url)
    if not m:
        raise ValueError(f"Identifiant YouTube introuvable dans : {url}")
    return m.group(1)


def _info_to_meta(info: dict[str, Any]) -> dict[str, Any]:
    """Normalize yt-dlp's info dict to the same shape spotify_client exposes."""
    upload = info.get("upload_date") or ""  # YYYYMMDD
    iso_date = f"{upload[:4]}-{upload[4:6]}-{upload[6:8]}" if len(upload) == 8 else None
    return {
        "video_id": info.get("id") or "",
        "title": info.get("title") or "",
        "channel": info.get("uploader") or info.get("channel") or "",
        "duration_sec": int(info.get("duration") or 0) or None,
        "release_date": iso_date,
        "language": (info.get("language") or "").split("-")[0].lower() or None,
        "webpage_url": info.get("webpage_url") or "",
    }


def _extract_info_sync(url: str) -> dict[str, Any]:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,  # treat playlist URLs as the first video.
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False) or {}


async def get_metadata(url: str) -> dict[str, Any]:
    try:
        info = await asyncio.to_thread(_extract_info_sync, url)
    except yt_dlp.utils.DownloadError as e:
        raise RuntimeError(f"YouTube : impossible de lire la vidéo ({e})") from e
    return _info_to_meta(info)


def _download_audio_sync(
    url: str,
    dest_path: Path,
    progress_cb: Callable[[float], None] | None,
) -> None:
    """Download bestaudio + extract to mp3 at dest_path.

    yt-dlp's outtmpl drives the filename; we point it directly at dest_path
    (without extension, ffmpeg postprocessor appends .mp3).
    """
    # Strip suffix so ffmpeg's postprocessor lands on dest_path exactly.
    stem = dest_path.with_suffix("")

    def _hook(d: dict[str, Any]) -> None:
        if progress_cb is None:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                try:
                    progress_cb(min(0.99, done / total))
                except Exception:  # noqa: BLE001
                    pass

    opts: dict[str, Any] = {
        "format": "bestaudio/best",
        "outtmpl": str(stem) + ".%(ext)s",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }
        ],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "progress_hooks": [_hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    # Sanity-check: ffmpeg postprocessor should have written stem.mp3.
    mp3 = Path(str(stem) + ".mp3")
    if not mp3.exists():
        raise RuntimeError(
            f"yt-dlp n'a pas produit le fichier audio attendu : {mp3}"
        )
    if mp3 != dest_path:
        mp3.replace(dest_path)


async def download_audio(
    url: str,
    dest_path: Path,
    progress_cb: Callable[[float], None] | None = None,
) -> None:
    try:
        await asyncio.to_thread(_download_audio_sync, url, dest_path, progress_cb)
    except yt_dlp.utils.DownloadError as e:
        raise RuntimeError(f"YouTube : téléchargement échoué ({e})") from e


# ─── Captions extraction ────────────────────────────────────────────────────

_VTT_TIMESTAMP_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})"
)
_VTT_TAG_RE = re.compile(r"<[^>]+>")


def _parse_vtt_time(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def _parse_vtt(content: str) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    for block in re.split(r"\n\s*\n", content):
        lines = [ln for ln in block.split("\n") if ln.strip()]
        for i, line in enumerate(lines):
            m = _VTT_TIMESTAMP_RE.search(line)
            if not m:
                continue
            start = _parse_vtt_time(*m.group(1, 2, 3, 4))
            end = _parse_vtt_time(*m.group(5, 6, 7, 8))
            text = " ".join(lines[i + 1 :])
            text = _VTT_TAG_RE.sub("", text).strip()
            text = re.sub(r"\s+", " ", text)
            if text:
                segments.append({"start": start, "end": end, "text": text})
            break
    return segments


def _merge_sliding_windows(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Collapse YouTube auto-caption sliding-window duplication.

    YT auto-captions emit overlapping windows: each new cue contains the last
    N words of the previous cue plus a new word or two at the end. We detect
    that overlap (longest matching suffix-of-prev = prefix-of-cur, word level)
    and keep only the *new* tail of each segment, appended to the running one.
    """
    if not segments:
        return []
    out: list[dict[str, Any]] = [dict(segments[0])]
    for seg in segments[1:]:
        prev = out[-1]
        prev_words = prev["text"].split()
        cur_words = seg["text"].split()
        if not cur_words:
            continue
        # Longest k where prev's last k words == cur's first k words.
        overlap = 0
        max_k = min(len(prev_words), len(cur_words))
        for k in range(max_k, 0, -1):
            if prev_words[-k:] == cur_words[:k]:
                overlap = k
                break
        if overlap == len(cur_words):
            # cur is fully contained at the tail of prev — extend time only.
            prev["end"] = float(seg.get("end", prev.get("end", 0.0)))
            continue
        new_words = cur_words[overlap:]
        if overlap > 0:
            # Same growing sentence — append new tail to prev.
            prev["text"] = prev["text"] + " " + " ".join(new_words)
            prev["end"] = float(seg.get("end", prev.get("end", 0.0)))
        else:
            # No overlap — independent segment.
            out.append(dict(seg))
    return out


def _pick_caption_url(
    subs_dict: dict[str, Any] | None, prefer_lang: str | None
) -> tuple[str, str] | None:
    """Return ``(lang, vtt_url)`` or None."""
    if not subs_dict:
        return None
    priority: list[str] = []
    if prefer_lang:
        priority.append(prefer_lang)
        priority.append(prefer_lang.split("-")[0])
    priority.extend(["en", "fr"])
    priority.extend(list(subs_dict.keys()))

    seen: set[str] = set()
    for lang in priority:
        if lang in seen:
            continue
        seen.add(lang)
        formats = subs_dict.get(lang) or subs_dict.get(lang.split("-")[0])
        if not formats:
            continue
        for fmt in formats:
            if fmt.get("ext") == "vtt" and fmt.get("url"):
                return lang, fmt["url"]
        for fmt in formats:
            if fmt.get("url"):
                return lang, fmt["url"]
    return None


async def fetch_captions(
    url: str, prefer_lang: str | None = None
) -> tuple[str | None, list[dict[str, Any]]]:
    """Try to grab the YouTube captions (manual first, then auto).

    Returns ``(language, segments)`` if captions are available, else ``(None, [])``.
    Sliding-window duplicates from auto-captions remain in the output — the
    cleanup pass (``dedupe_segments``) handles them downstream.
    """
    try:
        info = await asyncio.to_thread(_extract_info_sync, url)
    except yt_dlp.utils.DownloadError as e:
        raise RuntimeError(f"YouTube : impossible de lire la vidéo ({e})") from e

    pick = _pick_caption_url(info.get("subtitles"), prefer_lang)
    kind = "manual"
    if not pick:
        pick = _pick_caption_url(info.get("automatic_captions"), prefer_lang)
        kind = "auto"
    if not pick:
        logger.info("YT captions: none available for %s", info.get("id"))
        return None, []

    lang, vtt_url = pick
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(vtt_url)
        if resp.status_code != 200:
            logger.warning(
                "YT captions fetch failed: HTTP %s for %s", resp.status_code, vtt_url
            )
            return None, []
        content = resp.text

    raw_segments = _parse_vtt(content)
    segments = _merge_sliding_windows(raw_segments)
    logger.info(
        "YT captions: %s (%s/%s) → %d raw → %d merged",
        info.get("id"), lang, kind, len(raw_segments), len(segments),
    )
    return lang.split("-")[0], segments
