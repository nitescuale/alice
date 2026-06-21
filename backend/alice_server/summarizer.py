"""LLM-based transcript summarization via Groq llama-3.1-8b-instant.

Three detail levels: ``court`` (3-5 bullets, ~150 words), ``moyen`` (2-4 sections,
~400 words), ``long`` (4-6 sections, ~1000-1500 words). The LLM writes in the
same language as the transcript. Single-shot summarization — Groq's 128k
context fits a ~4h transcript easily.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

from alice_server import groq_chat, ollama
from alice_server.config import get_groq_api_key

logger = logging.getLogger(__name__)

SUMMARY_LEVELS = ("court", "moyen", "long")

_LEVEL_INSTRUCTIONS = {
    "court": (
        "Niveau **Court** : 3 à 5 puces en markdown qui résument uniquement "
        "les points essentiels. ~150 mots maximum. Pas de sections, juste "
        "une liste à puces."
    ),
    "moyen": (
        "Niveau **Moyen** : 2 à 4 sections, chacune introduite par un titre "
        "`### Titre`. Sous chaque titre, 3 à 5 puces qui développent le thème. "
        "~400 mots au total. Couvre les axes principaux abordés."
    ),
    "long": (
        "Niveau **Long** : synthèse narrative structurée en 4 à 6 sections, "
        "chacune introduite par un titre `## Titre`. Chaque section développe "
        "les arguments, faits, exemples cités, avec ~200-300 mots. ~1000-1500 "
        "mots au total. Inclus des timestamps `[mm:ss]` quand un passage est "
        "particulièrement marquant ou cité."
    ),
}

SYSTEM_PROMPT_BASE = (
    "Tu rédiges un résumé d'un transcript de podcast ou de vidéo. Le transcript "
    "est annoté avec des timestamps `[mm:ss]` au début de chaque ligne. "
    "Rédige le résumé DANS LA MÊME LANGUE QUE LE TRANSCRIPT (français si "
    "français, anglais si anglais, etc.). "
    "Retourne UNIQUEMENT le markdown du résumé — pas de préambule type "
    "'Voici le résumé', pas de phrase d'introduction méta. Commence directement "
    "par le contenu."
)


def _format_timecode(sec: float) -> str:
    s = int(sec)
    h, rem = divmod(s, 3600)
    m, sc = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sc:02d}"
    return f"{m}:{sc:02d}"


def _build_transcript_text(segments: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        ts = _format_timecode(float(seg.get("start", 0.0)))
        parts.append(f"[{ts}] {text}")
    return "\n".join(parts)


class _ProgressEstimator:
    """Mutable elapsed/expected estimator — the LLM call has no real progress
    signal, so we tick a clamped fraction based on wall-clock time. ``reset``
    lets us re-anchor when we switch backends (e.g. Groq → Ollama)."""

    def __init__(self, expected_seconds: float) -> None:
        self.expected = max(expected_seconds, 1.0)
        self.t0 = time.monotonic()

    def reset(self, new_expected: float) -> None:
        self.expected = max(new_expected, 1.0)
        self.t0 = time.monotonic()

    def fraction(self) -> float:
        elapsed = time.monotonic() - self.t0
        return min(0.95, elapsed / self.expected)


async def _ticker(
    cb: Callable[[float], None],
    est: _ProgressEstimator,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        try:
            cb(est.fraction())
        except Exception:  # noqa: BLE001
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=1.5)
        except asyncio.TimeoutError:
            continue


def _estimate_groq_seconds(level: str, input_chars: int) -> float:
    # llama-3.1-8b on Groq: ~750 tok/s end-to-end. Rough modelling.
    base = {"court": 5.0, "moyen": 10.0, "long": 25.0}[level]
    # Prompt processing scales with input. ~6k chars/s on Groq.
    prompt_s = input_chars / 6000.0
    return base + prompt_s


def _estimate_ollama_seconds(level: str, input_chars: int) -> float:
    # Ollama on a mid-range GPU (RTX 2060, gemma2:2b / gemma4:e4b) is ~10-20×
    # slower than Groq. Conservative multiplier so the bar doesn't stick at 95%.
    base_out = {"court": 30.0, "moyen": 80.0, "long": 240.0}[level]
    prompt_s = input_chars / 400.0  # ~400 chars/s prompt eval on 2B-class models
    return base_out + prompt_s


async def summarize(
    segments: list[dict[str, Any]],
    level: str,
    language: str | None = None,
    progress_cb: Callable[[float], None] | None = None,
) -> str:
    if level not in SUMMARY_LEVELS:
        raise ValueError(
            f"Niveau de résumé inconnu : {level!r}. Attendu : {SUMMARY_LEVELS}"
        )
    if not segments:
        raise ValueError("Aucun segment à résumer.")

    transcript = _build_transcript_text(segments)
    system_prompt = SYSTEM_PROMPT_BASE + "\n\n" + _LEVEL_INSTRUCTIONS[level]
    lang_hint = f"Langue détectée : {language}.\n" if language else ""
    user_prompt = f"{lang_hint}\nTranscript :\n{transcript}".strip()

    logger.info(
        "Summary: level=%s, segments=%d, transcript_chars=%d",
        level, len(segments), len(transcript),
    )

    num_predict = {"court": 500, "moyen": 1200, "long": 3000}[level]
    use_groq = bool(get_groq_api_key())

    # Start the progress ticker with the optimistic (Groq) estimate; we'll
    # re-anchor it if we fall back to Ollama.
    estimator = _ProgressEstimator(
        _estimate_groq_seconds(level, len(transcript))
        if use_groq
        else _estimate_ollama_seconds(level, len(transcript))
    )
    stop_event = asyncio.Event()
    ticker_task: asyncio.Task[None] | None = None
    if progress_cb is not None:
        ticker_task = asyncio.create_task(_ticker(progress_cb, estimator, stop_event))

    try:
        if use_groq:
            try:
                raw = await groq_chat.generate(
                    user_prompt,
                    system=system_prompt,
                    temperature=0.4,
                    num_predict=num_predict,
                )
                return raw.strip()
            except RuntimeError as exc:
                msg = str(exc)
                is_overload = (
                    "413" in msg
                    or "429" in msg
                    or "rate_limit" in msg
                    or "too large" in msg.lower()
                )
                if not is_overload:
                    raise
                logger.warning(
                    "Groq summary rejected (%s) — falling back to local Ollama.",
                    msg[:120],
                )
                # Re-anchor progress with the Ollama estimate.
                estimator.reset(_estimate_ollama_seconds(level, len(transcript)))

        raw = await ollama.generate(
            user_prompt,
            system=system_prompt,
            temperature=0.4,
            num_predict=num_predict,
            timeout=1500.0,
        )
        return raw.strip()
    finally:
        stop_event.set()
        if ticker_task is not None:
            try:
                await ticker_task
            except Exception:  # noqa: BLE001
                pass
        if progress_cb is not None:
            try:
                progress_cb(1.0)
            except Exception:  # noqa: BLE001
                pass
