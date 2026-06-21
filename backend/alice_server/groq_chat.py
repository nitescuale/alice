"""Groq Chat Completions wrapper.

Mirrors the surface of ``alice_server.ollama.generate`` so callers can swap
backends without restructuring. Targets the OpenAI-compatible endpoint
``/openai/v1/chat/completions`` with ``llama-3.1-8b-instant`` — fast, cheap,
JSON-mode friendly. Free tier is 30 RPM / 6k TPM, which is fine for the
chunked transcript polish (one chunk every ~1-2s, serial).
"""

from __future__ import annotations

from typing import Any

import httpx

from alice_server.config import get_groq_api_key

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.1-8b-instant"
HTTP_TIMEOUT_S = 60.0


async def generate(
    prompt: str,
    system: str | None = None,
    model: str | None = None,
    temperature: float = 0.4,
    force_json: bool = False,
    num_predict: int | None = None,
) -> str:
    api_key = get_groq_api_key()
    if not api_key:
        raise RuntimeError(
            "Clé API Groq absente. Configure-la dans Réglages → Groq Cloud."
        )

    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload: dict[str, Any] = {
        "model": model or DEFAULT_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if num_predict is not None:
        payload["max_tokens"] = num_predict
    if force_json:
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
        r = await client.post(
            GROQ_CHAT_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
        if r.status_code != 200:
            raise RuntimeError(f"Groq Chat API {r.status_code}: {r.text[:500]}")
        data = r.json()

    choices = data.get("choices") or []
    if not choices:
        return ""
    return choices[0].get("message", {}).get("content", "") or ""
