"""GitHub repository import via the Git Trees API + raw.githubusercontent.com.

Strategy
--------
1. Resolve owner/repo/ref from a GitHub URL or explicit parameters.
2. Fetch the full recursive tree in ONE API call (no per-file rate-limit hits).
3. Download each supported file via raw.githubusercontent.com – no auth needed
   for public repos, and this endpoint is not subject to the GitHub REST
   rate-limit quota the same way as the API.
4. Write files under  <subjects_root>/github/<owner>__<repo>/<path>
   and return a manifest so the caller can upsert into ChromaDB.

Supported extensions: .md .txt .py .ipynb  (PDF is binary, skip for now –
raw.githubusercontent.com serves PDF fine but extraction is done elsewhere).
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from alice_server.config import SUBJECTS_ROOT

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SUPPORTED_EXTS = {".md", ".txt", ".py", ".ipynb", ".pdf"}
_TREE_API = "https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1"
_RAW_URL = "https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}"
_BRANCHES_API = "https://api.github.com/repos/{owner}/{repo}/branches"
_COMMITS_API = "https://api.github.com/repos/{owner}/{repo}/commits/{ref}"


def parse_github_url(url: str) -> tuple[str, str, str]:
    """Return (owner, repo, ref) from a GitHub URL.

    Handles:
      https://github.com/owner/repo
      https://github.com/owner/repo/tree/branch
      https://github.com/owner/repo/blob/branch/path/file.md
    Falls back to ref="HEAD" when not present.
    """
    parsed = urlparse(url.strip())
    if parsed.netloc not in ("github.com", "www.github.com"):
        raise ValueError(f"Not a github.com URL: {url!r}")
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        raise ValueError(f"Cannot parse owner/repo from {url!r}")
    owner, repo = parts[0], parts[1]
    repo = re.sub(r"\.git$", "", repo)
    ref = "HEAD"
    if len(parts) >= 4 and parts[2] in ("tree", "blob"):
        ref = parts[3]
    return owner, repo, ref


async def _default_branch(client: httpx.AsyncClient, owner: str, repo: str) -> str:
    """Fetch the default branch name."""
    url = f"https://api.github.com/repos/{owner}/{repo}"
    r = await client.get(url)
    r.raise_for_status()
    return r.json().get("default_branch", "main")


async def _resolve_tree_sha(
    client: httpx.AsyncClient, owner: str, repo: str, ref: str
) -> str:
    """Resolve a branch/tag/HEAD ref to the tree SHA for the root commit."""
    if ref == "HEAD":
        ref = await _default_branch(client, owner, repo)
    url = _COMMITS_API.format(owner=owner, repo=repo, ref=ref)
    r = await client.get(url)
    r.raise_for_status()
    data = r.json()
    return data["commit"]["tree"]["sha"]


async def fetch_tree(
    owner: str,
    repo: str,
    ref: str = "HEAD",
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Return list of blob entries from the recursive tree API."""
    headers: dict[str, str] = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(headers=headers, timeout=60.0) as client:
        tree_sha = await _resolve_tree_sha(client, owner, repo, ref)
        url = _TREE_API.format(owner=owner, repo=repo, sha=tree_sha)
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()

    blobs = [
        item
        for item in data.get("tree", [])
        if item["type"] == "blob"
        and Path(item["path"]).suffix.lower() in SUPPORTED_EXTS
    ]
    return blobs


async def _download_file(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    ref: str,
    path: str,
) -> bytes | None:
    url = _RAW_URL.format(owner=owner, repo=repo, ref=ref, path=path)
    try:
        r = await client.get(url, follow_redirects=True)
        if r.status_code == 200:
            return r.content
    except Exception:  # noqa: BLE001
        pass
    return None


async def import_repo(
    url: str,
    token: str | None = None,
    max_files: int = 200,
) -> dict[str, Any]:
    """Download a GitHub repo's text files into subjects/github/<owner>__<repo>/.

    Returns a summary dict with ``dest_dir``, ``files_written``, ``skipped``.
    """
    owner, repo, ref = parse_github_url(url)

    # Resolve actual branch name if ref is HEAD (needed for raw URLs)
    headers: dict[str, str] = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(headers=headers, timeout=60.0) as client:
        if ref == "HEAD":
            ref = await _default_branch(client, owner, repo)

        blobs = await fetch_tree(owner, repo, ref, token=token)
        blobs = blobs[:max_files]

        dest_dir = SUBJECTS_ROOT / "github" / f"{owner}__{repo}"
        dest_dir.mkdir(parents=True, exist_ok=True)

        sem = asyncio.Semaphore(8)  # cap concurrent downloads

        async def download_one(item: dict[str, Any]) -> tuple[str, bool]:
            async with sem:
                data = await _download_file(client, owner, repo, ref, item["path"])
            if data is None:
                return item["path"], False
            out = dest_dir / item["path"]
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            return item["path"], True

        results = await asyncio.gather(*[download_one(b) for b in blobs])

    written = [p for p, ok in results if ok]
    skipped = [p for p, ok in results if not ok]

    return {
        "owner": owner,
        "repo": repo,
        "ref": ref,
        "dest_dir": str(dest_dir),
        "files_written": len(written),
        "skipped": len(skipped),
        "paths": written,
    }
