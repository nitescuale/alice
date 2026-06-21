"""Cloud transcription via Deepgram Nova-2.

Nova-2 runs at ~40× real-time on Deepgram's infra for ~$0.26/h. Free tier
ships with $200 of credit on signup (~750 hours of audio), no per-hour rate
cap that we'd hit in normal use, and a 2 GB upload limit — well above
anything ALICE will throw at it.

We POST the raw audio bytes to ``/v1/listen`` with ``utterances=true`` so we
get speech-bounded segments comparable to Whisper's ``segments`` output.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

import httpx

from alice_server.config import get_deepgram_api_key

logger = logging.getLogger(__name__)

DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_MODEL = "nova-2"
HTTP_TIMEOUT_S = 1200.0  # 20 min — Nova-2 chews through 2h audio in ~3 min.


def _segments_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    utterances = (payload.get("results") or {}).get("utterances") or []
    out: list[dict[str, Any]] = []
    for u in utterances:
        text = (u.get("transcript") or "").strip()
        if not text:
            continue
        seg: dict[str, Any] = {
            "start": float(u.get("start", 0.0)),
            "end": float(u.get("end", 0.0)),
            "text": text,
        }
        # Deepgram tags each utterance with a 0-indexed speaker integer when
        # diarize=true is set. Keep it as-is — frontend renders "Locuteur N+1".
        speaker = u.get("speaker")
        if isinstance(speaker, int):
            seg["speaker"] = speaker
        out.append(seg)
    return out


def _detected_language(payload: dict[str, Any], fallback: str | None) -> str:
    # Deepgram returns the detected language under several possible paths
    # depending on the request shape; check the common ones.
    results = payload.get("results") or {}
    channels = results.get("channels") or []
    if channels:
        lang = channels[0].get("detected_language")
        if isinstance(lang, str) and lang:
            return lang.strip().lower()[:2]
    meta_lang = (payload.get("metadata") or {}).get("detected_language")
    if isinstance(meta_lang, str) and meta_lang:
        return meta_lang.strip().lower()[:2]
    return (fallback or "en").strip().lower()[:2]


async def transcribe(
    audio_path: Path,
    language: str | None = None,
    progress_cb: Any = None,
) -> dict[str, Any]:
    api_key = get_deepgram_api_key()
    if not api_key:
        raise RuntimeError(
            "Clé API Deepgram absente. Configure-la dans Réglages → Deepgram."
        )

    if progress_cb is not None:
        try:
            progress_cb(0.05)
        except Exception:  # noqa: BLE001
            pass

    params: dict[str, Any] = {
        "model": DEEPGRAM_MODEL,
        "smart_format": "true",
        "punctuate": "true",
        "utterances": "true",
        "diarize": "true",  # tag each utterance with speaker 0/1/2...
    }
    if language:
        params["language"] = language
    else:
        params["detect_language"] = "true"

    # Read into memory: typical podcast ≤ 200 MB, well under any sensible cap.
    audio_bytes = await asyncio.to_thread(audio_path.read_bytes)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
        resp = await client.post(
            DEEPGRAM_API_URL,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "audio/*",  # let Deepgram sniff the codec
            },
            params=params,
            content=audio_bytes,
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Deepgram API {resp.status_code}: {resp.text[:500]}")
    payload = resp.json()

    segments = _segments_from_payload(payload)
    duration = float((payload.get("metadata") or {}).get("duration") or 0.0)
    if not duration and segments:
        duration = segments[-1]["end"]

    if progress_cb is not None:
        try:
            progress_cb(1.0)
        except Exception:  # noqa: BLE001
            pass

    return {
        "language": _detected_language(payload, language),
        "segments": segments,
        "duration": duration,
        "model_used": f"deepgram-{DEEPGRAM_MODEL}",
    }
