"""Interview question bank ingestion.

Fetches `youssefHosni/Data-Science-Interview-Questions-Answers` (root-level
`.md` topic files), parses each into (question, reference answer) pairs, and
returns a flat list ready to be upserted into SQLite.

Each topic markdown file has the layout:

    # Deep Learning Interview Questions for Data Scientists #
    ## Questions ##
    ...table of contents (list items with links)...
    ## Questions & Answers ##
    ### Q1: ... ###
    Answer:
    ...body...
    ### Q2: ... ###
    ...

Headings mixing `##` and `###` are both used across files. Between questions
you may find non-Q section headers (e.g. `# Natural Language Processing #`);
these terminate the current question body.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

import httpx

from alice_server import ollama

REPO_OWNER = "youssefHosni"
REPO_NAME = "Data-Science-Interview-Questions-Answers"
REPO_REF = "main"

_TREE_API = (
    f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/git/trees/{REPO_REF}?recursive=1"
)
_RAW_URL = (
    f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{REPO_REF}/{{path}}"
)

_Q_HEADING_RE = re.compile(
    r"^#{1,4}\s+Q(\d+)\s*[:.)\-]\s*(.+?)\s*#*\s*$",
    re.IGNORECASE,
)
_ANY_H1_H2_RE = re.compile(r"^#{1,2}\s+\S.*$")
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
# `Answer:`, `**Answer**:`, `### Answer ###`, etc. — the marker that ends the
# question body and starts the reference answer.
_ANSWER_MARKER_RE = re.compile(
    r"^\s*(?:#{1,6}\s*)?\**\s*Answer\s*\**\s*:?\s*\**\s*#*\s*$",
    re.IGNORECASE,
)
# `https://github.com/<user>/<repo>/blob/<ref>/<path>` → raw.githubusercontent
_GITHUB_BLOB_RE = re.compile(
    r"https?://github\.com/([^/\s)]+)/([^/\s)]+)/blob/([^/\s)]+)/([^\s)]+)"
)
# Leading ordinal prefixes the translation LLM sometimes keeps from our
# numbered prompt: `1. `, `12) `, `3: `. Anchored so it does not match inside.
_LEADING_ORDINAL_RE = re.compile(r"^\s*\d{1,3}\s*[.)\-:]\s+")


def _rewrite_image_urls(text: str) -> str:
    """Rewrite every GitHub blob URL to a raw URL so images actually render."""
    return _GITHUB_BLOB_RE.sub(
        lambda m: f"https://raw.githubusercontent.com/{m.group(1)}/{m.group(2)}/{m.group(3)}/{m.group(4)}",
        text,
    )


def _strip_leading_ordinal(text: str) -> str:
    return _LEADING_ORDINAL_RE.sub("", text, count=1)


def _topic_slug(filename: str) -> str:
    """`Deep Learning Questions & Answers for Data Scientists.md` -> `deep-learning`."""
    name = filename.rsplit("/", 1)[-1]
    name = re.sub(r"\.md$", "", name, flags=re.IGNORECASE)
    # Drop the generic suffix shared by every file
    name = re.sub(
        r"\s*(Interview)?\s*Questions?\s*(&|and)?\s*Answers?\s*(for\s+Data\s+Scientists)?\s*$",
        "",
        name,
        flags=re.IGNORECASE,
    ).strip()
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return slug or "misc"


def _topic_label(filename: str) -> str:
    name = filename.rsplit("/", 1)[-1]
    name = re.sub(r"\.md$", "", name, flags=re.IGNORECASE)
    name = re.sub(
        r"\s*(Interview)?\s*Questions?\s*(&|and)?\s*Answers?\s*(for\s+Data\s+Scientists)?\s*$",
        "",
        name,
        flags=re.IGNORECASE,
    ).strip()
    return name or filename


def _is_topic_file(path: str) -> bool:
    """Keep root-level markdown files that look like Q&A topic files."""
    if "/" in path:
        return False
    if not path.lower().endswith(".md"):
        return False
    low = path.lower()
    if "readme" in low:
        return False
    return "question" in low and "answer" in low


def parse_topic_md(text: str) -> list[dict[str, Any]]:
    """Extract Q/A pairs from one topic markdown file.

    Returns a list of {idx, question, reference_answer} with idx = Qn number.
    """
    lines = text.splitlines()
    items: list[dict[str, Any]] = []
    cur_idx: int | None = None
    cur_q: str | None = None
    cur_body: list[str] = []

    def flush() -> None:
        nonlocal cur_idx, cur_q, cur_body
        if cur_q is None or cur_idx is None:
            return
        # Split the body at the `Answer:` marker. Everything before belongs
        # to the question (it typically contains the table / image the
        # question refers to). Everything after is the reference answer.
        pre: list[str] = []
        post: list[str] = []
        seen_answer = False
        for bl in cur_body:
            if not seen_answer and _ANSWER_MARKER_RE.match(bl):
                seen_answer = True
                continue
            (post if seen_answer else pre).append(bl)
        # Fallback: legacy `Answer: ...` (marker inline on the same line as
        # the first sentence) — strip only that prefix from the first non-
        # empty line of the post buffer when no dedicated marker was found.
        if not seen_answer:
            post = pre
            pre = []
        answer = "\n".join(post).strip()
        answer = re.sub(r"^\s*\**Answer\**\s*:\s*", "", answer, flags=re.IGNORECASE).strip()
        extra = "\n".join(pre).strip()
        question_full = cur_q
        if extra:
            question_full = f"{cur_q}\n\n{_rewrite_image_urls(extra)}"
        answer = _rewrite_image_urls(answer)
        # Keep only if the answer has some substance
        if len(answer) >= 40:
            items.append(
                {
                    "idx": cur_idx,
                    "question": question_full,
                    "reference_answer": answer,
                }
            )
        cur_idx = None
        cur_q = None
        cur_body = []

    for line in lines:
        m = _Q_HEADING_RE.match(line)
        if m:
            flush()
            cur_idx = int(m.group(1))
            cur_q = m.group(2).strip()
            cur_body = []
            continue
        # A non-Q h1/h2 section header terminates the current question body
        if cur_q is not None and _ANY_H1_H2_RE.match(line) and "Q" not in line[:6]:
            flush()
            continue
        if cur_q is not None:
            cur_body.append(line)
    flush()
    return items


async def fetch_topic_files(token: str | None = None) -> list[str]:
    """Return list of root-level topic markdown file paths."""
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(headers=headers, timeout=60.0) as client:
        r = await client.get(_TREE_API)
        r.raise_for_status()
        data = r.json()
    tree = data.get("tree", [])
    return sorted(
        entry["path"]
        for entry in tree
        if entry.get("type") == "blob" and _is_topic_file(entry["path"])
    )


_TRANSLATE_SYSTEM = (
    "Tu es traducteur technique anglais→français spécialisé en data science. "
    "Tu préserves la précision technique et conserves les termes anglais quand "
    "ils sont standards (backpropagation, batch normalization, dropout, overfitting, "
    "gradient descent, etc.). Tu ne reformules pas, tu traduis."
)


async def _translate_batch(questions: list[str]) -> list[str]:
    """Translate a batch of English questions to French via Ollama.

    Falls back to originals on any failure.
    """
    if not questions:
        return []
    numbered = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions))
    prompt = (
        "Traduis chaque question ci-dessous en français. "
        "Retourne STRICTEMENT un objet JSON au format "
        '{"translations": ["...", "...", ...]} '
        "avec exactement autant d'entrées qu'il y a de questions, dans le même ordre.\n\n"
        f"Questions à traduire :\n{numbered}\n"
    )
    try:
        raw = await ollama.generate(
            prompt,
            system=_TRANSLATE_SYSTEM,
            temperature=0.1,
            force_json=True,
        )
        data = json.loads(raw)
        translations = data.get("translations") if isinstance(data, dict) else None
        if isinstance(translations, list) and len(translations) == len(questions):
            out: list[str] = []
            for t, q in zip(translations, questions):
                cleaned = _strip_leading_ordinal(str(t).strip())
                out.append(cleaned or q)
            return out
    except (json.JSONDecodeError, httpx.HTTPError, KeyError, ValueError, TypeError):
        pass
    return list(questions)


async def translate_questions(
    questions: list[str], batch_size: int = 10, concurrency: int = 3
) -> list[str]:
    """Translate a list of questions to French, batched for throughput."""
    if not questions:
        return []
    batches = [
        questions[i : i + batch_size] for i in range(0, len(questions), batch_size)
    ]
    sem = asyncio.Semaphore(concurrency)

    async def run(batch: list[str]) -> list[str]:
        async with sem:
            return await _translate_batch(batch)

    results = await asyncio.gather(*(run(b) for b in batches))
    out: list[str] = []
    for r in results:
        out.extend(r)
    return out


async def fetch_and_parse_all(token: str | None = None, translate: bool = False) -> dict[str, Any]:
    """Fetch every topic file, parse it, return a flat list of bank items.

    Return shape:
        {
          "topics": [{"slug": ..., "label": ..., "source_path": ..., "count": N}, ...],
          "items":  [{"topic": slug, "topic_label": label, "source_path": ...,
                      "idx": int, "question": str, "reference_answer": str}, ...],
        }
    """
    paths = await fetch_topic_files(token=token)
    if not paths:
        return {"topics": [], "items": []}

    topics: list[dict[str, Any]] = []
    all_items: list[dict[str, Any]] = []

    headers = {"Accept": "text/plain"}
    async with httpx.AsyncClient(headers=headers, timeout=60.0) as client:
        for path in paths:
            encoded = path.replace(" ", "%20").replace("&", "%26")
            url = f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{REPO_REF}/{encoded}"
            try:
                r = await client.get(url)
                r.raise_for_status()
            except httpx.HTTPError:
                continue
            slug = _topic_slug(path)
            label = _topic_label(path)
            parsed = parse_topic_md(r.text)
            for p in parsed:
                all_items.append(
                    {
                        "topic": slug,
                        "topic_label": label,
                        "source_path": path,
                        "idx": p["idx"],
                        "question": p["question"],
                        "reference_answer": p["reference_answer"],
                    }
                )
            topics.append(
                {
                    "slug": slug,
                    "label": label,
                    "source_path": path,
                    "count": len(parsed),
                }
            )

    if translate and all_items:
        try:
            fr = await translate_questions([it["question"] for it in all_items])
            if len(fr) == len(all_items):
                for it, translated in zip(all_items, fr):
                    it["question_en"] = it["question"]
                    it["question"] = translated
        except Exception:
            # Translation failures are non-fatal: keep English questions.
            pass

    return {"topics": topics, "items": all_items}
