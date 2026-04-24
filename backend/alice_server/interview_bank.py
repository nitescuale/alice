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

import re
from typing import Any

import httpx

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
        body = "\n".join(cur_body).strip()
        body = re.sub(r"^\s*Answer\s*:\s*\n?", "", body, flags=re.IGNORECASE)
        body = body.strip()
        # Keep only if the answer has some substance
        if len(body) >= 40:
            items.append({"idx": cur_idx, "question": cur_q, "reference_answer": body})
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


async def fetch_and_parse_all(token: str | None = None) -> dict[str, Any]:
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

    return {"topics": topics, "items": all_items}
