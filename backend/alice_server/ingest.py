"""Walk taxonomy + files, chunk, index."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import yaml

from alice_server.chunking import chunk_by_paragraphs
from alice_server.config import SUBJECTS_ROOT
from alice_server.extract import extract_file
from alice_server import rag


def load_taxonomy() -> dict[str, Any]:
    path = SUBJECTS_ROOT / "taxonomy.yaml"
    if not path.exists():
        return {"subjects": []}
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {"subjects": []}


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def index_courses() -> dict[str, Any]:
    """Rebuild course chunks from taxonomy + chapter folders."""
    tax = load_taxonomy()
    indexed_files = 0
    chunk_count = 0
    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict[str, Any]] = []

    for subj in tax.get("subjects", []):
        sid = subj["id"]
        for course in subj.get("courses", []):
            cid = course["id"]
            for ch in course.get("chapters", []):
                chid = ch["id"]
                rel = ch.get("path", f"{sid}/{cid}/{chid}")
                ch_dir = SUBJECTS_ROOT / rel
                if not ch_dir.is_dir():
                    continue
                for fp in sorted(ch_dir.rglob("*")):
                    if fp.is_file() and fp.suffix.lower() in (
                        ".pdf",
                        ".md",
                        ".markdown",
                        ".txt",
                        ".ipynb",
                        ".py",
                    ):
                        text = extract_file(fp)
                        rel_path = str(fp.relative_to(SUBJECTS_ROOT))
                        chunks = chunk_by_paragraphs(
                            text,
                            source_path=rel_path,
                            chapter_id=chid,
                            course_id=cid,
                            subject_id=sid,
                        )
                        for c in chunks:
                            ids.append(rag.new_id())
                            documents.append(c.text)
                            metadatas.append(
                                {
                                    "source_path": c.source_path,
                                    "chapter_id": chid,
                                    "course_id": cid,
                                    "subject_id": sid,
                                    "offset_start": c.offset_start,
                                    "offset_end": c.offset_end,
                                    "file_sha256": file_hash(fp),
                                }
                            )
                        indexed_files += 1
                        chunk_count += len(chunks)

    col = rag.get_course_collection()
    col.delete(where={})  # full rebuild
    if ids:
        rag.upsert_course_chunks(ids, documents, metadatas)

    return {
        "indexed_files": indexed_files,
        "chunks": chunk_count,
        "subjects_root": str(SUBJECTS_ROOT),
    }


def index_interviews() -> dict[str, Any]:
    """Index markdown/json under subjects/interviews/."""
    root = SUBJECTS_ROOT / "interviews"
    if not root.exists():
        return {"indexed": 0, "chunks": 0}

    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict[str, Any]] = []

    for fp in sorted(root.rglob("*")):
        if not fp.is_file():
            continue
        if fp.suffix.lower() not in (".md", ".txt", ".json"):
            continue
        company = fp.relative_to(root).parts[0] if len(fp.relative_to(root).parts) > 1 else "general"
        text = fp.read_text(encoding="utf-8", errors="replace")
        chunks = chunk_by_paragraphs(
            text,
            source_path=str(fp.relative_to(SUBJECTS_ROOT)),
            chapter_id="interview",
            course_id=company,
            subject_id="interviews",
        )
        for c in chunks:
            ids.append(rag.new_id())
            documents.append(c.text)
            metadatas.append(
                {
                    "source_path": c.source_path,
                    "chapter_id": "interview",
                    "course_id": company,
                    "subject_id": "interviews",
                    "company": company,
                }
            )

    col = rag.get_interview_collection()
    col.delete(where={})
    if ids:
        rag.upsert_interview_chunks(ids, documents, metadatas)

    return {"indexed": len(ids), "chunks": len(documents)}
