"""Post-transcription cleanup for podcast transcripts.

Two passes:
  1. Deterministic dedup of consecutive whisper hallucinations (same/contained text).
  2. LLM polish via Ollama, chunked, with strict 1:1 segment contract — start/end
     are preserved Python-side; only `text` is rewritten.

If the LLM fails or returns invalid output for a chunk, that chunk falls back
to its dedup-only text. The whole job never fails because of the LLM step.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Awaitable, Callable

from alice_server import ollama

logger = logging.getLogger(__name__)

CHUNK_SIZE = 30
PREV_CONTEXT = 2

ProgressCb = Callable[[int, int], Awaitable[None] | None]

_PUNCT_RE = re.compile(r"[^\w\s]+", re.UNICODE)


def _norm(text: str) -> str:
    return _PUNCT_RE.sub("", text or "").lower().strip()


def dedupe_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse consecutive duplicate or contained segments.

    - N consecutive segments with identical normalized text → keep first, extend `end`.
    - A segment whose normalized text is contained in the previous segment's
      normalized text (and non-empty) → drop it, extend previous `end`.
    """
    if not segments:
        return []
    out: list[dict[str, Any]] = [dict(segments[0])]
    for seg in segments[1:]:
        prev = out[-1]
        cur_n = _norm(seg.get("text", ""))
        prev_n = _norm(prev.get("text", ""))
        if not cur_n:
            out.append(dict(seg))
            continue
        if cur_n == prev_n:
            prev["end"] = float(seg.get("end", prev.get("end", 0.0)))
            continue
        if cur_n in prev_n and len(cur_n) >= 3:
            prev["end"] = float(seg.get("end", prev.get("end", 0.0)))
            continue
        out.append(dict(seg))
    return out


_SYSTEM_PROMPT = (
    "You clean up speech-to-text transcript segments. "
    "Fix capitalization, punctuation, and obvious typos. "
    "Do NOT change wording, do NOT translate, do NOT merge or split segments. "
    "Items prefixed with prev=true are READ-ONLY context — do not include them in your output. "
    "Return STRICT JSON of the form: {\"segments\": [{\"i\": <int>, \"text\": \"<cleaned>\"}, ...]} "
    "with exactly the same indices and the same number of items as the editable input, in order."
)


def _build_prompt(
    chunk: list[dict[str, Any]],
    chunk_start_idx: int,
    prev_tail: list[dict[str, Any]],
    language: str | None,
) -> str:
    items: list[dict[str, Any]] = []
    for k, seg in enumerate(prev_tail):
        items.append({"i": chunk_start_idx - len(prev_tail) + k, "prev": True, "text": seg.get("text", "")})
    for k, seg in enumerate(chunk):
        items.append({"i": chunk_start_idx + k, "text": seg.get("text", "")})
    lang_hint = f"\nLanguage: {language}." if language else ""
    return (
        f"Clean these segments.{lang_hint}\n"
        f"Editable indices: {chunk_start_idx}..{chunk_start_idx + len(chunk) - 1}.\n"
        f"Input:\n{json.dumps(items, ensure_ascii=False)}"
    )


def _parse_polish_response(raw: str, expected_indices: list[int]) -> list[str] | None:
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    segs = data.get("segments") if isinstance(data, dict) else data
    if not isinstance(segs, list) or len(segs) != len(expected_indices):
        return None
    by_idx: dict[int, str] = {}
    for item in segs:
        if not isinstance(item, dict):
            return None
        try:
            i = int(item.get("i"))
        except (TypeError, ValueError):
            return None
        text = item.get("text")
        if not isinstance(text, str):
            return None
        by_idx[i] = text
    if set(by_idx.keys()) != set(expected_indices):
        return None
    return [by_idx[i] for i in expected_indices]


async def _polish_chunk(
    chunk: list[dict[str, Any]],
    chunk_start_idx: int,
    prev_tail: list[dict[str, Any]],
    language: str | None,
) -> list[str]:
    prompt = _build_prompt(chunk, chunk_start_idx, prev_tail, language)
    try:
        raw = await ollama.generate(
            prompt,
            system=_SYSTEM_PROMPT,
            temperature=0.2,
            force_json=True,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("polish chunk %d failed (ollama error): %s", chunk_start_idx, exc)
        return [seg.get("text", "") for seg in chunk]

    expected = list(range(chunk_start_idx, chunk_start_idx + len(chunk)))
    parsed = _parse_polish_response(raw, expected)
    if parsed is None:
        logger.warning(
            "polish chunk %d failed (invalid LLM output, len=%d expected=%d), falling back",
            chunk_start_idx,
            len(raw),
            len(expected),
        )
        return [seg.get("text", "") for seg in chunk]
    return parsed


async def polish_segments(
    segments: list[dict[str, Any]],
    language: str | None,
    progress_cb: ProgressCb | None = None,
) -> list[dict[str, Any]]:
    if not segments:
        return []
    chunks: list[tuple[int, list[dict[str, Any]]]] = []
    for start in range(0, len(segments), CHUNK_SIZE):
        chunks.append((start, segments[start : start + CHUNK_SIZE]))
    total = len(chunks)

    out: list[dict[str, Any]] = [dict(s) for s in segments]
    for done, (start_idx, chunk) in enumerate(chunks, start=1):
        prev_tail = segments[max(0, start_idx - PREV_CONTEXT) : start_idx]
        cleaned_texts = await _polish_chunk(chunk, start_idx, prev_tail, language)
        for k, text in enumerate(cleaned_texts):
            out[start_idx + k]["text"] = text.strip()
        if progress_cb is not None:
            res = progress_cb(done, total)
            if hasattr(res, "__await__"):
                await res  # type: ignore[func-returns-value]
    return out


async def clean_transcript(
    segments: list[dict[str, Any]],
    language: str | None = None,
    progress_cb: ProgressCb | None = None,
) -> list[dict[str, Any]]:
    deduped = dedupe_segments(segments)
    polished = await polish_segments(deduped, language=language, progress_cb=progress_cb)
    return polished
