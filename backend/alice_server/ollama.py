"""Call local Ollama HTTP API."""

from __future__ import annotations

from typing import Any

import httpx

from alice_server.config import get_ollama_host, get_ollama_model


async def generate(
    prompt: str,
    system: str | None = None,
    model: str | None = None,
    temperature: float = 0.4,
) -> str:
    m = model or get_ollama_model()
    host = get_ollama_host()
    url = f"{host.rstrip('/')}/api/generate"
    payload: dict[str, Any] = {
        "model": m,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature},
    }
    if system:
        payload["system"] = system

    async with httpx.AsyncClient(timeout=300.0) as client:
        r = await client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
        return data.get("response", "")


async def list_models() -> list[str]:
    url = f"{get_ollama_host().rstrip('/')}/api/tags"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
        return [m["name"] for m in data.get("models", [])]


def format_rag_context(query_result: dict[str, Any]) -> str:
    docs = query_result.get("documents", [[]])[0]
    metas = query_result.get("metadatas", [[]])[0]
    parts = []
    for i, doc in enumerate(docs):
        meta = metas[i] if i < len(metas) else {}
        src = meta.get("source_path", "?")
        parts.append(f"[{src}]\n{doc}")
    return "\n\n---\n\n".join(parts)
