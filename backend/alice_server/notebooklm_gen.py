"""NotebookLM-driven course generation pipeline.

Wraps `notebooklm-py` to automate the previously manual PDF-to-markdown step:
the user uploads a slides PDF, the backend drives NotebookLM programmatically
to produce the course markdown and saves it as a chapter.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from alice_server.config import SUBJECTS_ROOT
from alice_server import ingest


_TASKS: dict[str, dict[str, Any]] = {}
_LOCK = asyncio.Lock()

_SUPPORTED_EXTS = (".pdf", ".md", ".markdown", ".txt", ".docx")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_task() -> str:
    """Register a new task and return its id."""
    task_id = str(uuid.uuid4())
    _TASKS[task_id] = {
        "status": "pending",
        "stage": "pending",
        "progress_msg": "En attente…",
        "result": None,
        "error": None,
        "created_at": _now_iso(),
    }
    return task_id


def get_task(task_id: str) -> dict[str, Any] | None:
    return _TASKS.get(task_id)


def _update(task_id: str, **fields: Any) -> None:
    t = _TASKS.get(task_id)
    if t is None:
        return
    t.update(fields)


async def check_auth() -> dict[str, Any]:
    """Probe the NotebookLM session. Never raises."""
    try:
        from notebooklm import NotebookLMClient  # type: ignore
    except Exception as exc:  # noqa: BLE001
        return {
            "authenticated": False,
            "message": f"Librairie notebooklm-py non installée ({exc}).",
        }

    try:
        async with await NotebookLMClient.from_storage() as client:
            await client.notebooks.list()
        return {"authenticated": True, "message": "Connecté à NotebookLM."}
    except FileNotFoundError:
        return {
            "authenticated": False,
            "message": "Aucune session NotebookLM trouvée. Exécute `notebooklm login` en CLI.",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "authenticated": False,
            "message": f"Impossible de se connecter à NotebookLM: {exc}",
        }


async def run_generation(
    task_id: str,
    pdf_bytes: bytes,
    pdf_filename: str,
    subject_title: str,
    chapter_title: str,
    reindex: bool,
) -> None:
    """Drive the full NotebookLM pipeline and save the result as a chapter."""
    # Lazy imports to avoid circular deps and module-load failures when
    # notebooklm-py is not installed.
    from alice_server.main import _slugify, _ensure_taxonomy_entry

    tmp_pdf: str | None = None
    tmp_md: str | None = None

    ext = Path(pdf_filename).suffix.lower() or ".pdf"
    if ext not in _SUPPORTED_EXTS:
        _update(
            task_id,
            status="error",
            progress_msg=f"Format non supporté: {ext}",
            error=f"Formats acceptés: {', '.join(_SUPPORTED_EXTS)}",
        )
        return

    try:
        async with _LOCK:
            _update(
                task_id,
                status="running",
                stage="auth",
                progress_msg="Connexion à NotebookLM…",
            )

        from notebooklm import NotebookLMClient, ReportFormat  # type: ignore

        async with await NotebookLMClient.from_storage() as client:
            _update(
                task_id,
                stage="notebook",
                progress_msg="Création du notebook…",
            )
            nb = await client.notebooks.create(f"{subject_title} — {chapter_title}")

            # Persist source to tempfile for the client (preserve extension so
            # NotebookLM detects the right MIME type).
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as fh:
                fh.write(pdf_bytes)
                tmp_pdf = fh.name

            _update(
                task_id,
                stage="upload",
                progress_msg="Envoi du fichier vers NotebookLM…",
            )
            await client.sources.add_file(nb.id, Path(tmp_pdf))

            _update(
                task_id,
                stage="generate",
                progress_msg="Génération du cours (peut prendre 1-3 min)…",
            )
            prompt_path = SUBJECTS_ROOT / "NOTEBOOKLM_PROMPT.md"
            if not prompt_path.exists():
                raise FileNotFoundError(
                    f"NOTEBOOKLM_PROMPT.md introuvable ({prompt_path})."
                )
            custom_prompt = prompt_path.read_text(encoding="utf-8")

            status = await client.artifacts.generate_report(
                nb.id,
                report_format=ReportFormat.CUSTOM,
                custom_prompt=custom_prompt,
                language="fr",
            )

            _update(
                task_id,
                stage="wait",
                progress_msg="NotebookLM génère le contenu…",
            )
            await client.artifacts.wait_for_completion(
                nb.id, status.task_id, timeout=900
            )

            _update(
                task_id,
                stage="download",
                progress_msg="Téléchargement du markdown…",
            )
            with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as fh:
                tmp_md = fh.name
            await client.artifacts.download_report(nb.id, tmp_md)
            md_content = Path(tmp_md).read_text(encoding="utf-8")

        _update(
            task_id,
            stage="save",
            progress_msg="Enregistrement du chapitre…",
        )
        subject_id = _slugify(subject_title)
        chapter_id = _slugify(chapter_title)
        rel_path = f"{subject_id}/{chapter_id}"

        ch_dir = SUBJECTS_ROOT / rel_path
        ch_dir.mkdir(parents=True, exist_ok=True)
        dest = ch_dir / "Cours.md"
        dest.write_text(md_content, encoding="utf-8")

        _ensure_taxonomy_entry(
            subject_id,
            subject_title,
            chapter_id,
            chapter_title,
            rel_path,
        )

        result: dict[str, Any] = {
            "subject_id": subject_id,
            "chapter_id": chapter_id,
            "path": rel_path,
            "filename": "Cours.md",
        }

        if reindex:
            _update(
                task_id,
                stage="reindex",
                progress_msg="Réindexation RAG…",
            )
            try:
                idx = ingest.index_courses()
                result["index"] = idx
            except Exception as exc:  # noqa: BLE001
                result["index_error"] = str(exc)

        _update(
            task_id,
            status="done",
            stage="done",
            progress_msg="Terminé.",
            result=result,
        )

    except Exception as exc:  # noqa: BLE001
        _update(
            task_id,
            status="error",
            progress_msg=f"Erreur: {exc}",
            error=str(exc),
        )
    finally:
        for p in (tmp_pdf, tmp_md):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass
