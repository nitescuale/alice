"""Extract plain text from PDF, Markdown, ipynb, py."""

from __future__ import annotations

from pathlib import Path

import fitz  # pymupdf


def extract_pdf(path: Path) -> str:
    doc = fitz.open(path)
    parts: list[str] = []
    for page in doc:
        parts.append(page.get_text())
    doc.close()
    return "\n\n".join(parts)


def extract_markdown(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def extract_ipynb(path: Path) -> str:
    import nbformat

    nb = nbformat.read(path, as_version=4)
    out: list[str] = []
    for cell in nb.cells:
        if cell.cell_type == "markdown":
            out.append(cell.get("source", ""))
        elif cell.cell_type == "code":
            out.append(f"```python\n{cell.get('source', '')}\n```")
    return "\n\n".join(out)


def extract_py(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def extract_file(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".pdf":
        return extract_pdf(path)
    if suf in (".md", ".markdown", ".txt"):
        return extract_markdown(path)
    if suf == ".ipynb":
        return extract_ipynb(path)
    if suf == ".py":
        return extract_py(path)
    return path.read_text(encoding="utf-8", errors="replace")
