"""FastAPI entrypoint."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from alice_server import ingest, ollama, rag, store
from alice_server.config import (
    OLLAMA_HOST,
    OLLAMA_MODEL,
    SUBJECTS_ROOT,
    get_ollama_host,
    get_ollama_model,
    set_ollama_runtime,
)
from alice_server.extract import extract_file
from alice_server import github_import

app = FastAPI(title="ALICE Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    store.init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return {
        "subjects_root": str(SUBJECTS_ROOT),
        "ollama_host": get_ollama_host(),
        "ollama_model": get_ollama_model(),
    }


class IndexBody(BaseModel):
    interviews: bool = True


@app.post("/api/index/rebuild")
def rebuild_index(body: IndexBody | None = None) -> dict[str, Any]:
    body = body or IndexBody()
    out = ingest.index_courses()
    if body.interviews:
        out["interviews"] = ingest.index_interviews()
    return out


@app.get("/api/taxonomy")
def taxonomy() -> dict[str, Any]:
    return ingest.load_taxonomy()


class RagQuery(BaseModel):
    query: str
    n_results: int = 8
    chapter_id: str | None = None
    subject_id: str | None = None


@app.post("/api/rag/query")
def rag_query(body: RagQuery) -> dict[str, Any]:
    res = rag.query_courses(
        body.query,
        n_results=body.n_results,
        chapter_id=body.chapter_id,
        subject_id=body.subject_id,
    )
    return {
        "documents": res.get("documents", [[]]),
        "metadatas": res.get("metadatas", [[]]),
        "distances": res.get("distances", [[]]),
    }


class ChapterContent(BaseModel):
    subject_id: str
    chapter_id: str


@app.post("/api/chapter/content")
def chapter_content(body: ChapterContent) -> dict[str, Any]:
    """Return concatenated text + file list for a chapter (for display)."""
    tax = ingest.load_taxonomy()
    ch_dir: Path | None = None
    for subj in tax.get("subjects", []):
        if subj["id"] != body.subject_id:
            continue
        for ch in subj.get("chapters", []):
            if ch["id"] == body.chapter_id:
                rel = ch.get("path", f"{body.subject_id}/{body.chapter_id}")
                ch_dir = SUBJECTS_ROOT / rel
                break
    if ch_dir is None or not ch_dir.is_dir():
        raise HTTPException(404, "Chapter not found")

    files: list[dict[str, str]] = []
    texts: list[str] = []
    for fp in sorted(ch_dir.rglob("*")):
        if fp.is_file() and fp.suffix.lower() in (
            ".pdf",
            ".md",
            ".markdown",
            ".txt",
            ".ipynb",
            ".py",
        ):
            try:
                t = extract_file(fp)
            except Exception as e:  # noqa: BLE001
                t = f"(erreur lecture {fp.name}: {e})"
            rel = str(fp.relative_to(SUBJECTS_ROOT))
            files.append({"path": rel, "name": fp.name})
            texts.append(f"## {fp.name}\n\n{t}")
    return {
        "files": files,
        "markdown": "\n\n".join(texts) if texts else "_Aucun fichier supporté dans ce chapitre._",
    }


class AssistBody(BaseModel):
    question: str
    chapter_id: str | None = None
    subject_id: str | None = None


@app.post("/api/assist")
async def assist(body: AssistBody) -> dict[str, str]:
    """RAG + Ollama: réponse pédagogique (pas UI « où c'est dit »)."""
    rq = rag.query_courses(
        body.question,
        n_results=10,
        chapter_id=body.chapter_id,
        subject_id=body.subject_id,
    )
    ctx = ollama.format_rag_context(rq)
    prompt = f"""Contexte extrait du cours (extraits pertinents) :
{ctx}

Question de l'utilisateur : {body.question}

Réponds en français de façon claire et structurée. Base-toi sur le contexte; si une information manque, dis-le."""
    system = "Tu es un tuteur pédagogique ALICE. Réponses concises et exactes."
    text = await ollama.generate(prompt, system=system)
    return {"answer": text}


_BATCH_SIZE = 10  # questions per LLM call


def _parse_questions(raw: str) -> list[dict[str, Any]]:
    """Extract questions list from a raw LLM response (may be wrapped in markdown)."""
    raw = raw.strip()
    # Strip markdown code fences if present
    if "```" in raw:
        parts = raw.split("```")
        for part in parts[1:]:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part:
                raw = part
                break

    # Try direct parse first, then fallback to extracting the first {...} block
    for candidate in [raw]:
        try:
            data = json.loads(candidate)
            qs = data.get("questions", [])
            if isinstance(qs, list):
                return _validate_questions(qs)
        except json.JSONDecodeError:
            pass

    # Fallback: extract the first JSON object from the text
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
            qs = data.get("questions", [])
            if isinstance(qs, list):
                return _validate_questions(qs)
        except json.JSONDecodeError:
            pass

    return []


def _validate_questions(qs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter out malformed questions: must have 4 non-trivial options."""
    valid = []
    for q in qs:
        opts = q.get("options", [])
        question_text = q.get("q", "")
        correct = q.get("correct", 0)
        if not question_text or not isinstance(opts, list):
            continue
        # Filter options that are single letters or empty
        real_opts = [o for o in opts if isinstance(o, str) and len(o.strip()) > 1]
        if len(real_opts) < 4:
            continue
        # Keep only the first 4 options
        q["options"] = real_opts[:4]
        q["correct"] = min(int(correct), 3)
        valid.append(q)
    return valid


class QuizGenBody(BaseModel):
    chapter_id: str
    subject_id: str
    num_questions: int = 10


@app.post("/api/quiz/generate")
async def quiz_generate(body: QuizGenBody) -> dict[str, Any]:
    """Génère un QCM via RAG + Ollama en batches de 10 questions max."""
    num = max(1, min(body.num_questions, 50))  # cap at 50

    rq = rag.query_courses(
        f"notions importantes cours chapitre {body.chapter_id}",
        n_results=12,
        chapter_id=body.chapter_id,
        subject_id=body.subject_id,
    )
    ctx = ollama.format_rag_context(rq)

    if not ctx.strip():
        raise HTTPException(
            status_code=422,
            detail="Aucun contenu indexé pour ce chapitre. Cliquez sur « Réindexer RAG » dans l'écran Cours d'abord.",
        )

    all_questions: list[dict[str, Any]] = []
    remaining = num

    while remaining > 0:
        batch_n = min(remaining, _BATCH_SIZE)
        # Build a seed of already-generated question texts so the model avoids
        # duplicates across batches.
        already = ""
        if all_questions:
            prev_texts = "\n".join(f"- {q['q']}" for q in all_questions[:20])
            already = f"\nQuestions déjà générées (ne pas répéter) :\n{prev_texts}\n"

        prompt = f"""Voici le contenu du cours sur lequel tu dois te baser EXCLUSIVEMENT :

{ctx}
{already}
À partir de CE CONTENU UNIQUEMENT, génère exactement {batch_n} questions à choix multiples.
Chaque question doit avoir EXACTEMENT 4 propositions (pas plus, pas moins), dont une seule est correcte.
INTERDIT de poser des questions qui ne sont pas directement liées au contenu ci-dessus.
Réponds UNIQUEMENT avec un JSON valide, sans texte avant ni après, de ce schéma :
{{"questions":[{{"q":"Quelle est la définition de X ?","options":["Première réponse possible","Deuxième réponse possible","Troisième réponse possible","Quatrième réponse possible"],"correct":0}}]}}
correct est l'index (0, 1, 2 ou 3) de la bonne réponse. Les options doivent être des phrases complètes, pas des lettres. Questions en français."""

        raw = await ollama.generate(
            prompt,
            system="Tu écris du JSON strict sans markdown.",
            temperature=0.4,
        )
        batch = _parse_questions(raw)
        if batch:
            all_questions.extend(batch[:batch_n])
        else:
            # If the LLM failed to produce valid JSON, stop batching
            if not all_questions:
                return {"questions": [], "raw": raw}
            break
        remaining -= batch_n

    return {"questions": all_questions}


class QuizGradeBody(BaseModel):
    chapter_id: str
    answers: dict[str, int] = Field(default_factory=dict)
    questions: list[dict[str, Any]]


@app.post("/api/quiz/grade")
def quiz_grade(body: QuizGradeBody) -> dict[str, Any]:
    correct = 0
    total = len(body.questions)
    for i, q in enumerate(body.questions):
        key = str(i)
        if int(body.answers.get(key, -1)) == int(q.get("correct", -2)):
            correct += 1
    score = correct / total if total else 0.0
    store.record_quiz_attempt(body.chapter_id, float(correct), total)
    return {"correct": correct, "total": total, "score": score}


class OpenEvalBody(BaseModel):
    question: str
    answer: str
    chapter_id: str | None = None
    subject_id: str | None = None


@app.post("/api/quiz/open-eval")
async def open_eval(body: OpenEvalBody) -> dict[str, str]:
    rq = rag.query_courses(body.question, n_results=6, chapter_id=body.chapter_id, subject_id=body.subject_id)
    ctx = ollama.format_rag_context(rq)
    prompt = f"""Contexte :
{ctx}

Question : {body.question}
Réponse de l'étudiant :
{body.answer}

Évalue la réponse (critique constructive, points manquants). Réponds en français en 2-3 paragraphes."""
    text = await ollama.generate(prompt, system="Correcteur pédagogique bienveillant mais exigeant.")
    return {"feedback": text}


class InterviewBody(BaseModel):
    problem: str
    company: str | None = None
    mode: str = "hint"


@app.post("/api/interview/interact")
async def interview_interact(body: InterviewBody) -> dict[str, str]:
    iq = rag.query_interviews(body.problem, n_results=6, company=body.company)
    ctx = ollama.format_rag_context(iq)
    if body.mode == "hint":
        prompt = f"""Contexte problèmes similaires :
{ctx}

Problème actuel :
{body.problem}

Donne un indice court (sans solution complète). Français."""
    else:
        prompt = f"""Contexte :
{ctx}

Problème :
{body.problem}

Explique une approche de solution et des points d'attention. Français."""
    text = await ollama.generate(prompt, system="Coach entretien technique.")
    return {"reply": text}


class InterviewEvalBody(BaseModel):
    problem: str
    candidate_answer: str
    company: str | None = None


@app.post("/api/interview/evaluate")
async def interview_evaluate(body: InterviewEvalBody) -> dict[str, str]:
    iq = rag.query_interviews(body.problem, n_results=4, company=body.company)
    ctx = ollama.format_rag_context(iq)
    prompt = f"""Référence (extraits) :
{ctx}

Problème : {body.problem}
Réponse candidate : {body.candidate_answer}

Évalue sur : clarté, complexité algorithmique, cas limites, tests. Donne une note sur 10 et un paragraphe brutal mais constructif. Français."""
    text = await ollama.generate(prompt, system="Intervieweur senior technique.")
    return {"evaluation": text}


@app.get("/api/progress/quiz")
def progress_quiz(chapter_id: str | None = None) -> list[dict[str, Any]]:
    return store.quiz_history(chapter_id)


@app.get("/api/progress/chapters")
def progress_chapters() -> list[dict[str, Any]]:
    return store.chapter_history()


@app.post("/api/progress/chapter/{chapter_id}")
def progress_chapter(chapter_id: str) -> dict[str, str]:
    store.touch_chapter(chapter_id)
    return {"ok": "true"}


@app.get("/api/ollama/models")
async def ollama_models() -> dict[str, list[str]]:
    try:
        models = await ollama.list_models()
    except Exception as e:  # noqa: BLE001
        return {"models": [], "error": str(e)}
    return {"models": models}


class SettingsBody(BaseModel):
    ollama_host: str | None = None
    ollama_model: str | None = None


@app.get("/api/settings")
def settings_get() -> dict[str, str]:
    return {"ollama_host": get_ollama_host(), "ollama_model": get_ollama_model()}


@app.post("/api/settings")
def settings_post(body: SettingsBody) -> dict[str, str]:
    set_ollama_runtime(host=body.ollama_host, model=body.ollama_model)
    return {"ollama_host": get_ollama_host(), "ollama_model": get_ollama_model()}


# ---------------------------------------------------------------------------
# GitHub import
# ---------------------------------------------------------------------------

class GitHubImportBody(BaseModel):
    url: str
    token: str | None = None
    max_files: int = 200
    reindex: bool = True  # auto-index after import


@app.post("/api/github/import")
async def github_import_repo(body: GitHubImportBody) -> dict[str, Any]:
    """Import a public GitHub repository into subjects/github/<owner>__<repo>/.

    Downloads text/code files via the Git Trees API + raw.githubusercontent.com
    (single tree call, no per-file rate limiting).  Optionally triggers a RAG
    rebuild afterwards.
    """
    try:
        result = await github_import.import_repo(
            url=body.url,
            token=body.token or None,
            max_files=body.max_files,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if body.reindex and result.get("files_written", 0) > 0:
        try:
            idx = ingest.index_courses()
            result["index"] = idx
        except Exception as exc:  # noqa: BLE001
            result["index_error"] = str(exc)

    return result


# ---------------------------------------------------------------------------
# Course file upload (NotebookLM output)
# ---------------------------------------------------------------------------

@app.get("/api/notebooklm-prompt")
def notebooklm_prompt() -> dict[str, str]:
    """Return the NotebookLM prompt markdown."""
    prompt_path = SUBJECTS_ROOT / "NOTEBOOKLM_PROMPT.md"
    if not prompt_path.exists():
        raise HTTPException(404, "NOTEBOOKLM_PROMPT.md not found")
    return {"prompt": prompt_path.read_text(encoding="utf-8")}


def _slugify(text: str) -> str:
    """Simple slug: lowercase, spaces/underscores to hyphens, strip non-alnum."""
    import re
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9\s_-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text.strip("-") or "untitled"


def _ensure_taxonomy_entry(
    subject_id: str,
    subject_title: str,
    chapter_id: str,
    chapter_title: str,
    chapter_path: str,
) -> None:
    """Add subject/chapter to taxonomy.yaml if not already present."""
    tax_path = SUBJECTS_ROOT / "taxonomy.yaml"
    if tax_path.exists():
        tax = yaml.safe_load(tax_path.read_text(encoding="utf-8")) or {}
    else:
        tax = {}

    subjects: list[dict] = tax.setdefault("subjects", [])

    # Find or create subject
    subj = next((s for s in subjects if s["id"] == subject_id), None)
    if not subj:
        subj = {"id": subject_id, "title": subject_title, "chapters": []}
        subjects.append(subj)

    # Find or create chapter
    chapters: list[dict] = subj.setdefault("chapters", [])
    ch = next((c for c in chapters if c["id"] == chapter_id), None)
    if not ch:
        chapters.append({"id": chapter_id, "title": chapter_title, "path": chapter_path})

    tax_path.write_text(
        yaml.dump(tax, allow_unicode=True, default_flow_style=False, sort_keys=False),
        encoding="utf-8",
    )


class DeleteChapterBody(BaseModel):
    subject_id: str
    chapter_id: str


@app.post("/api/chapters/delete")
async def chapters_delete(body: DeleteChapterBody) -> dict[str, Any]:
    """Delete a chapter: remove files, update taxonomy, reindex RAG."""
    import shutil

    tax_path = SUBJECTS_ROOT / "taxonomy.yaml"
    if not tax_path.exists():
        raise HTTPException(404, "taxonomy.yaml not found")

    tax = yaml.safe_load(tax_path.read_text(encoding="utf-8")) or {}
    subjects: list[dict] = tax.get("subjects", [])

    subj = next((s for s in subjects if s["id"] == body.subject_id), None)
    if not subj:
        raise HTTPException(404, f"Subject '{body.subject_id}' not found")

    chapters: list[dict] = subj.get("chapters", [])
    chapter = next((c for c in chapters if c["id"] == body.chapter_id), None)
    if not chapter:
        raise HTTPException(404, f"Chapter '{body.chapter_id}' not found")

    # Remove chapter files from disk
    ch_path = chapter.get("path", f"{body.subject_id}/{body.chapter_id}")
    ch_dir = SUBJECTS_ROOT / ch_path
    if ch_dir.exists():
        shutil.rmtree(ch_dir)

    # Remove chapter from taxonomy
    chapters.remove(chapter)

    # If subject has no more chapters, remove it entirely
    if not chapters:
        subjects.remove(subj)
        subj_dir = SUBJECTS_ROOT / body.subject_id
        if subj_dir.exists() and not any(subj_dir.iterdir()):
            subj_dir.rmdir()

    tax_path.write_text(
        yaml.dump(tax, allow_unicode=True, default_flow_style=False, sort_keys=False),
        encoding="utf-8",
    )

    # Reindex RAG
    result: dict[str, Any] = {
        "deleted_subject": body.subject_id,
        "deleted_chapter": body.chapter_id,
    }
    try:
        idx = ingest.index_courses()
        result["index"] = idx
    except Exception as exc:  # noqa: BLE001
        result["index_error"] = str(exc)

    return result


@app.post("/api/courses/upload")
async def courses_upload(
    file: UploadFile,
    subject_title: str = Form(...),
    chapter_title: str = Form(...),
    reindex: str = Form("true"),
) -> dict[str, Any]:
    """Upload a NotebookLM-generated markdown file as a new chapter."""
    do_reindex = reindex.lower() in ("true", "1", "yes")
    if not file.filename:
        raise HTTPException(422, "No file provided")

    content = await file.read()
    text = content.decode("utf-8", errors="replace")

    subject_id = _slugify(subject_title)
    chapter_id = _slugify(chapter_title)
    rel_path = f"{subject_id}/{chapter_id}"

    ch_dir = SUBJECTS_ROOT / rel_path
    ch_dir.mkdir(parents=True, exist_ok=True)

    dest = ch_dir / (file.filename or "cours.md")
    dest.write_text(text, encoding="utf-8")

    _ensure_taxonomy_entry(
        subject_id, subject_title,
        chapter_id, chapter_title,
        rel_path,
    )

    result: dict[str, Any] = {
        "subject_id": subject_id,
        "chapter_id": chapter_id,
        "path": rel_path,
        "filename": dest.name,
    }

    if do_reindex:
        try:
            idx = ingest.index_courses()
            result["index"] = idx
        except Exception as exc:  # noqa: BLE001
            result["index_error"] = str(exc)

    return result


# ---------------------------------------------------------------------------
# Interview chat  (stateless — client sends full history each turn)
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class InterviewChatBody(BaseModel):
    messages: list[ChatMessage]
    problem: str | None = None   # optional context injected into system prompt
    company: str | None = None


@app.post("/api/interview/chat")
async def interview_chat(body: InterviewChatBody) -> dict[str, str]:
    """Stateless interview chat.

    The client owns the conversation history and sends it in full every turn.
    The backend prepends a system prompt (with optional RAG context) and calls
    Ollama /api/chat.
    """
    # Build RAG context from the problem description if provided
    rag_ctx = ""
    if body.problem and body.problem.strip():
        iq = rag.query_interviews(
            body.problem,
            n_results=5,
            company=body.company,
        )
        rag_ctx_raw = ollama.format_rag_context(iq)
        if rag_ctx_raw.strip():
            rag_ctx = f"\n\nRelevant reference problems:\n{rag_ctx_raw}"

    system = (
        "You are an experienced technical interviewer conducting a coding interview. "
        "Your role is to guide the candidate through the problem without giving away "
        "the solution directly. Ask clarifying questions, give hints when stuck, "
        "push back on suboptimal approaches, and evaluate trade-offs. "
        "Keep responses concise — 2-4 sentences unless a longer explanation is needed. "
        "Respond in the same language the candidate uses."
        f"{rag_ctx}"
    )

    history = [{"role": m.role, "content": m.content} for m in body.messages]

    reply = await ollama.chat(messages=history, system=system, temperature=0.6)
    return {"reply": reply}
