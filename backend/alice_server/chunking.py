"""Split extracted text into chunks with metadata."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Chunk:
    text: str
    source_path: str
    chapter_id: str
    course_id: str
    subject_id: str
    offset_start: int
    offset_end: int


def chunk_by_paragraphs(
    text: str,
    source_path: str,
    chapter_id: str,
    course_id: str,
    subject_id: str,
    max_chars: int = 1200,
    overlap: int = 200,
) -> list[Chunk]:
    """Sliding windows over paragraphs; falls back to raw split."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        return []

    chunks: list[Chunk] = []
    buf = ""
    base_off = 0

    for para in paragraphs:
        if len(buf) + len(para) + 2 <= max_chars:
            buf = f"{buf}\n\n{para}".strip() if buf else para
            continue
        if buf:
            off_end = base_off + len(buf)
            chunks.append(
                Chunk(
                    text=buf,
                    source_path=source_path,
                    chapter_id=chapter_id,
                    course_id=course_id,
                    subject_id=subject_id,
                    offset_start=base_off,
                    offset_end=off_end,
                )
            )
            base_off = off_end - overlap if overlap < len(buf) else off_end
            buf = para
        else:
            buf = para

    if buf:
        off_end = base_off + len(buf)
        chunks.append(
            Chunk(
                text=buf,
                source_path=source_path,
                chapter_id=chapter_id,
                course_id=course_id,
                subject_id=subject_id,
                offset_start=base_off,
                offset_end=off_end,
            )
        )

    return chunks
