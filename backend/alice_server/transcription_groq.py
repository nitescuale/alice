"""Cloud transcription via Groq's Whisper API.

Groq runs whisper-large-v3-turbo at ~25× real-time for ~$0.04/h. The on-disk
audio file is uploaded as multipart; we ask for ``verbose_json`` so we get
per-segment timestamps in the same shape as faster-whisper.

Free tier caps uploads at ~25 MB. We handle larger files in two stages:
  1. Re-encode to mp3 48 kbps mono 16 kHz (gets ~100 min under the cap).
  2. If still too big, split into ~50 min chunks via ffmpeg's segment muxer
     and upload them serially, offsetting timestamps to stitch one transcript.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx

from alice_server.config import get_groq_api_key

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"
MAX_UPLOAD_BYTES = 24 * 1024 * 1024  # 24 MB — under Groq's 25 MB free-tier cap.
HTTP_TIMEOUT_S = 600.0
RECOMPRESS_BITRATE = "48k"  # mono 16 kHz → ~6 KB/s → ~67 min fits 24 MB.
CHUNK_DURATION_S = 3000  # 50 min — comfortable margin under the size cap.
# Free-tier ASPH (audio-seconds-per-hour) bucket is 7200s (= 2h). Episodes
# longer than this can never complete on a single hourly budget — gate them
# upstream so the user gets a clear message before download.
MAX_AUDIO_DURATION_S = 7200

_LANG_NORMALISE = {
    "english": "en", "french": "fr", "spanish": "es", "german": "de",
    "italian": "it", "portuguese": "pt", "dutch": "nl", "russian": "ru",
    "japanese": "ja", "chinese": "zh", "korean": "ko", "arabic": "ar",
    "polish": "pl", "turkish": "tr", "swedish": "sv", "norwegian": "no",
    "danish": "da", "finnish": "fi", "czech": "cs", "greek": "el",
    "hebrew": "he", "hindi": "hi", "ukrainian": "uk", "romanian": "ro",
}


def _normalise_lang(value: str | None) -> str:
    if not value:
        return ""
    v = value.strip().lower()
    if len(v) == 2:
        return v
    return _LANG_NORMALISE.get(v, v[:2])


def _ffmpeg_required() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg is missing — install it (winget install ffmpeg) or switch "
            "to local transcription."
        )


def _audio_duration(path: Path) -> float:
    """Probe duration in seconds via ffprobe (ffmpeg sister tool)."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True, text=True, check=True,
        )
        return float((result.stdout or "0").strip() or 0.0)
    except (subprocess.CalledProcessError, ValueError):
        return 0.0


def _recompress(audio_path: Path, dest: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(audio_path),
            "-vn", "-ac", "1", "-ar", "16000", "-b:a", RECOMPRESS_BITRATE,
            str(dest),
        ],
        check=True, capture_output=True,
    )


def _split_audio(audio_path: Path, chunk_dir: Path) -> list[Path]:
    pattern = str(chunk_dir / "chunk_%04d.mp3")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(audio_path),
            "-vn", "-ac", "1", "-ar", "16000", "-b:a", RECOMPRESS_BITRATE,
            "-f", "segment", "-segment_time", str(CHUNK_DURATION_S),
            "-reset_timestamps", "1",
            pattern,
        ],
        check=True, capture_output=True,
    )
    return sorted(chunk_dir.glob("chunk_*.mp3"))


def _prepare_chunks(audio_path: Path) -> tuple[list[tuple[Path, float]], Path | None]:
    """Return (list of (upload_path, time_offset_seconds), tmpdir_to_cleanup_or_None).

    Three branches, in order of preference:
      - Small enough as-is → ship raw, no cleanup.
      - Recompresses under cap → ship single re-encoded file.
      - Otherwise split + recompress into ~50 min chunks, ship serially.
    """
    size = audio_path.stat().st_size
    if size <= MAX_UPLOAD_BYTES:
        return [(audio_path, 0.0)], None

    _ffmpeg_required()
    tmpdir = Path(tempfile.mkdtemp(prefix="alice_groq_"))
    try:
        # First try a single recompress.
        single = tmpdir / "audio.mp3"
        try:
            _recompress(audio_path, single)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"ffmpeg recompression failed: "
                f"{e.stderr.decode('utf-8', errors='replace')[:500]}"
            ) from e

        new_size = single.stat().st_size
        if new_size <= MAX_UPLOAD_BYTES:
            logger.info(
                "Groq: recompressed %s (%.1f MB → %.1f MB)",
                audio_path.name, size / 1024 / 1024, new_size / 1024 / 1024,
            )
            return [(single, 0.0)], tmpdir

        # Still too large: split.
        single.unlink(missing_ok=True)
        try:
            chunk_paths = _split_audio(audio_path, tmpdir)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"ffmpeg segment split failed: "
                f"{e.stderr.decode('utf-8', errors='replace')[:500]}"
            ) from e

        if not chunk_paths:
            raise RuntimeError("ffmpeg segment muxer produced no chunks.")

        # Sanity-check: every chunk must fit. Should never trigger at 48k/50min.
        for p in chunk_paths:
            if p.stat().st_size > MAX_UPLOAD_BYTES:
                raise RuntimeError(
                    f"Chunk {p.name} exceeds cap "
                    f"({p.stat().st_size / 1024 / 1024:.1f} MB) — "
                    "lower CHUNK_DURATION_S or RECOMPRESS_BITRATE."
                )

        # Cumulative offsets from real chunk durations (segment_time is approximate).
        offsets: list[float] = []
        running = 0.0
        for p in chunk_paths:
            offsets.append(running)
            running += _audio_duration(p)

        logger.info(
            "Groq: split %s into %d chunks (~%d min each), total ~%.0f min",
            audio_path.name, len(chunk_paths), CHUNK_DURATION_S // 60, running / 60,
        )
        return list(zip(chunk_paths, offsets)), tmpdir
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise


def _segments_from_response(
    payload: dict[str, Any], offset: float = 0.0
) -> list[dict[str, Any]]:
    raw = payload.get("segments") or []
    out: list[dict[str, Any]] = []
    for s in raw:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        out.append(
            {
                "start": float(s.get("start", 0.0)) + offset,
                "end": float(s.get("end", 0.0)) + offset,
                "text": text,
            }
        )
    return out


async def _upload_chunk(
    api_key: str, audio_path: Path, language: str | None
) -> dict[str, Any]:
    with audio_path.open("rb") as fh:
        files = {"file": (audio_path.name, fh, "application/octet-stream")}
        data: dict[str, Any] = {
            "model": GROQ_MODEL,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "segment",
            "temperature": "0",
        }
        if language:
            data["language"] = language

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
            resp = await client.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                files=files,
                data=data,
            )

    if resp.status_code != 200:
        raise RuntimeError(f"Groq API {resp.status_code}: {resp.text[:500]}")
    return resp.json()


async def transcribe(
    audio_path: Path,
    language: str | None = None,
    progress_cb: Any = None,
) -> dict[str, Any]:
    api_key = get_groq_api_key()
    if not api_key:
        raise RuntimeError(
            "Clé API Groq absente. Configure-la dans Réglages → Groq Cloud."
        )

    chunks, tmpdir = await asyncio.to_thread(_prepare_chunks, audio_path)
    n = len(chunks)

    if progress_cb is not None:
        try:
            progress_cb(0.05)
        except Exception:  # noqa: BLE001
            pass

    all_segments: list[dict[str, Any]] = []
    total_duration = 0.0
    final_language: str | None = None

    try:
        for i, (chunk_path, offset) in enumerate(chunks, start=1):
            payload = await _upload_chunk(api_key, chunk_path, language)
            all_segments.extend(_segments_from_response(payload, offset=offset))

            chunk_duration = float(payload.get("duration") or 0.0)
            total_duration = max(total_duration, offset + chunk_duration)
            if final_language is None:
                final_language = payload.get("language")

            if progress_cb is not None:
                try:
                    progress_cb(min(0.99, 0.05 + 0.95 * i / n))
                except Exception:  # noqa: BLE001
                    pass
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)

    if not total_duration and all_segments:
        total_duration = all_segments[-1]["end"]

    if progress_cb is not None:
        try:
            progress_cb(1.0)
        except Exception:  # noqa: BLE001
            pass

    return {
        "language": _normalise_lang(final_language) or (language or "en"),
        "segments": all_segments,
        "duration": total_duration,
        "model_used": f"groq-{GROQ_MODEL}",
    }
