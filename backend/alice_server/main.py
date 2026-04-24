"""FastAPI entrypoint."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from alice_server import ingest, interview_bank, notebooklm_gen, ollama, rag, store
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


@app.on_event("startup")
async def _startup_notebooklm_auth() -> None:
    # Kick off auth probe + auto-login in background; do not block app start.
    asyncio.create_task(notebooklm_gen.ensure_auth_ready())


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


_BATCH_SIZE = 5  # questions per LLM call — local models struggle with more
_MAX_RETRIES = 3  # retry on JSON parse failure


def _clean_json(raw: str) -> str:
    """Fix common JSON issues from LLM output."""
    # Remove trailing commas before ] or }
    raw = re.sub(r',\s*([}\]])', r'\1', raw)
    return raw


def _extract_questions(data: Any) -> list[dict[str, Any]]:
    """Extract questions list from parsed JSON (could be object or array)."""
    if isinstance(data, dict):
        qs = data.get("questions", [])
        if isinstance(qs, list):
            return _validate_questions(qs)
    elif isinstance(data, list):
        return _validate_questions(data)
    return []


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

    # Try direct parse
    cleaned = _clean_json(raw)
    try:
        data = json.loads(cleaned)
        qs = _extract_questions(data)
        if qs:
            return qs
    except json.JSONDecodeError:
        pass

    # Fallback: extract the first JSON object {...}
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        try:
            data = json.loads(_clean_json(raw[start:end + 1]))
            qs = _extract_questions(data)
            if qs:
                return qs
        except json.JSONDecodeError:
            pass

    # Fallback: extract the first JSON array [...]
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end > start:
        try:
            data = json.loads(_clean_json(raw[start:end + 1]))
            qs = _extract_questions(data)
            if qs:
                return qs
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


async def _dedup_questions(qs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Use the LLM to identify and remove duplicate/near-duplicate questions.

    Two questions are duplicates if they test the SAME concept, even when worded
    differently (e.g. "Qu'est-ce que le CC ?" vs "Que représente le CC ?").
    """
    numbered = "\n".join(
        f"{i}: {q['q']}" for i, q in enumerate(qs)
    )
    prompt = f"""Voici {len(qs)} questions numérotées d'un QCM :
{numbered}

Ta tâche : trouver les questions qui portent sur LE MÊME concept ou la même notion, même si la formulation est différente.
Deux questions sont des doublons si elles testent la même connaissance. Exemples :
- "Qu'est-ce que le coefficient de clustering ?" et "Que représente le CC dans un réseau ?" → doublons
- "Quelle est la définition de X ?" et "Comment définit-on X ?" → doublons

Pour chaque groupe de doublons, garde UNIQUEMENT la question la plus détaillée et complète (celle avec le plus d'informations dans l'énoncé).
Renvoie les indices des questions à SUPPRIMER.
{{"remove": [3, 7, 12]}}
Si aucun doublon : {{"remove": []}}"""

    try:
        raw = await ollama.generate(
            prompt,
            system="Analyse les questions et identifie les doublons sémantiques. Réponds UNIQUEMENT avec du JSON strict.",
            temperature=0.1,
            force_json=True,
        )
        data = json.loads(_clean_json(raw.strip()))
        to_remove = set(data.get("remove", []))
        if not to_remove:
            return qs
        return [q for i, q in enumerate(qs) if i not in to_remove]
    except Exception:
        return qs  # on failure, keep all questions


class QuizGenBody(BaseModel):
    chapter_id: str = ""
    subject_id: str
    num_questions: int = 10


@app.post("/api/quiz/generate")
async def quiz_generate(body: QuizGenBody) -> dict[str, Any]:
    """Échantillonne un QCM depuis la banque pré-générée (instantané, sans LLM)."""
    num = max(1, min(body.num_questions, 50))
    chapter_id = body.chapter_id or None
    result = store.sample_bank(body.subject_id, chapter_id, num)
    if not result:
        raise HTTPException(
            status_code=422,
            detail="Aucune banque de questions pour ce chapitre. Générez-la d'abord depuis la page Cours ou Quiz.",
        )
    return {"questions": result}


# ---------------------------------------------------------------------------
# Question bank management
# ---------------------------------------------------------------------------

_BANK_HARD_CAP = 50
_BANK_MAX_BATCHES = 12
_BANK_MIN_NEW_PER_BATCH = 2


class QuestionsGenBody(BaseModel):
    subject_id: str
    chapter_id: str
    force: bool = False


@app.post("/api/questions/generate")
async def questions_generate(body: QuestionsGenBody) -> dict[str, Any]:
    """Generate an exhaustive question bank for a chapter, persist in SQLite.

    If a bank already exists and `force=False`, returns the existing bank without
    regenerating. Otherwise runs batched generation against RAG context until a
    saturation condition is met (cap reached, too few new uniques, or max batches).
    """
    existing = store.bank_count(body.subject_id, body.chapter_id)
    if not body.force and existing > 0:
        return {
            "subject_id": body.subject_id,
            "chapter_id": body.chapter_id,
            "count": existing,
            "questions": store.list_bank(body.subject_id, body.chapter_id),
        }

    if body.force:
        store.clear_bank(body.subject_id, body.chapter_id)

    rq = rag.query_courses(
        f"notions importantes cours chapitre {body.chapter_id}",
        n_results=15,
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
    batches_done = 0

    while (
        len(all_questions) < _BANK_HARD_CAP
        and batches_done < _BANK_MAX_BATCHES
    ):
        before = len(all_questions)
        batch_n = _BATCH_SIZE

        already = ""
        if all_questions:
            prev_texts = "\n".join(f"- {q['q']}" for q in all_questions)
            already = (
                f"\n⚠️ QUESTIONS DÉJÀ GÉNÉRÉES — NE PAS répéter ni reformuler ces concepts :\n"
                f"{prev_texts}\n"
                f"Chaque nouvelle question DOIT porter sur un concept DIFFÉRENT de ceux ci-dessus.\n"
            )

        prompt = f"""Voici le contenu du cours sur lequel tu dois te baser EXCLUSIVEMENT :

{ctx}
{already}
À partir de CE CONTENU UNIQUEMENT, génère exactement {batch_n} questions à choix multiples.
Chaque question doit porter sur un concept ou une notion DIFFÉRENTE. INTERDIT de poser deux questions sur le même sujet.
Chaque question doit avoir EXACTEMENT 4 propositions (pas plus, pas moins), dont une seule est correcte.
INTERDIT de poser des questions qui ne sont pas directement liées au contenu ci-dessus.
Réponds UNIQUEMENT avec un JSON valide, sans texte avant ni après, de ce schéma :
{{"questions":[{{"q":"Quelle est la définition de X ?","options":["Première réponse possible","Deuxième réponse possible","Troisième réponse possible","Quatrième réponse possible"],"correct":0}}]}}
correct est l'index (0, 1, 2 ou 3) de la bonne réponse. Les options doivent être des phrases complètes, pas des lettres. Questions en français."""

        batch: list[dict[str, Any]] = []
        for _attempt in range(_MAX_RETRIES):
            raw = await ollama.generate(
                prompt,
                system="Tu écris du JSON strict sans markdown. Pas de commentaire, pas de markdown.",
                temperature=0.5,
                force_json=True,
            )
            batch = _parse_questions(raw)
            if batch:
                break

        batches_done += 1

        if not batch:
            # Nothing parsed this round — stop to avoid hammering
            break

        all_questions.extend(batch)

        # Dedupe cumulative list (LLM semantic dedup)
        if len(all_questions) > 3:
            all_questions = await _dedup_questions(all_questions)

        # Enforce hard cap post-dedup
        if len(all_questions) > _BANK_HARD_CAP:
            all_questions = all_questions[:_BANK_HARD_CAP]

        new_unique = len(all_questions) - before
        if new_unique < _BANK_MIN_NEW_PER_BATCH:
            break

    if not all_questions:
        raise HTTPException(
            status_code=502,
            detail="Échec de génération de questions (aucune question exploitable parsée).",
        )

    store.insert_questions(body.subject_id, body.chapter_id, all_questions)

    return {
        "subject_id": body.subject_id,
        "chapter_id": body.chapter_id,
        "count": len(all_questions),
        "questions": all_questions,
    }


@app.get("/api/questions/bank")
def questions_bank(subject_id: str, chapter_id: str) -> dict[str, Any]:
    count = store.bank_count(subject_id, chapter_id)
    return {
        "subject_id": subject_id,
        "chapter_id": chapter_id,
        "count": count,
        "has_bank": count > 0,
    }


@app.get("/api/questions/banks")
def questions_banks(subject_id: str) -> dict[str, Any]:
    chapters = store.banks_summary(subject_id)
    total = sum(int(c.get("count", 0)) for c in chapters)
    return {"subject_id": subject_id, "chapters": chapters, "total": total}


class QuestionsBankDeleteBody(BaseModel):
    subject_id: str
    chapter_id: str


@app.delete("/api/questions/bank")
def questions_bank_delete(body: QuestionsBankDeleteBody) -> dict[str, bool]:
    store.clear_bank(body.subject_id, body.chapter_id)
    return {"ok": True}


class QuizGradeBody(BaseModel):
    chapter_id: str = ""
    answers: dict[str, int] = Field(default_factory=dict)
    questions: list[dict[str, Any]]


@app.post("/api/quiz/grade")
def quiz_grade(body: QuizGradeBody) -> dict[str, Any]:
    correct = 0
    total = len(body.questions)
    details: list[dict[str, Any]] = []
    for i, q in enumerate(body.questions):
        key = str(i)
        user_ans = int(body.answers.get(key, -1))
        correct_idx = int(q.get("correct", -2))
        if user_ans == correct_idx:
            correct += 1
        details.append(
            {
                "q": q.get("q", ""),
                "options": q.get("options", []),
                "correct": correct_idx,
                "user_answer": user_ans,
                "hint": q.get("hint", ""),
                "rationales": q.get("rationales", []),
            }
        )
    score = correct / total if total else 0.0
    label = body.chapter_id or "all-chapters"
    attempt_id = store.record_quiz_attempt(label, float(correct), total, details=details)
    return {"correct": correct, "total": total, "score": score, "attempt_id": attempt_id}


@app.get("/api/quiz/attempt/{attempt_id}")
def quiz_attempt(attempt_id: int) -> dict[str, Any]:
    data = store.quiz_attempt_detail(attempt_id)
    if not data:
        raise HTTPException(404, "Attempt not found")
    return data


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


class DeleteSubjectBody(BaseModel):
    subject_id: str


@app.post("/api/subjects/delete")
async def subjects_delete(body: DeleteSubjectBody) -> dict[str, Any]:
    """Delete a subject and cascade-delete all its chapters (files + taxonomy)."""
    import shutil

    tax_path = SUBJECTS_ROOT / "taxonomy.yaml"
    if not tax_path.exists():
        raise HTTPException(404, "taxonomy.yaml not found")

    tax = yaml.safe_load(tax_path.read_text(encoding="utf-8")) or {}
    subjects: list[dict] = tax.get("subjects", [])

    subj = next((s for s in subjects if s["id"] == body.subject_id), None)
    if not subj:
        raise HTTPException(404, f"Subject '{body.subject_id}' not found")

    for chapter in subj.get("chapters", []) or []:
        ch_path = chapter.get("path", f"{body.subject_id}/{chapter['id']}")
        ch_dir = SUBJECTS_ROOT / ch_path
        if ch_dir.exists():
            shutil.rmtree(ch_dir, ignore_errors=True)

    subjects.remove(subj)
    subj_dir = SUBJECTS_ROOT / body.subject_id
    if subj_dir.exists():
        shutil.rmtree(subj_dir, ignore_errors=True)

    tax_path.write_text(
        yaml.dump(tax, allow_unicode=True, default_flow_style=False, sort_keys=False),
        encoding="utf-8",
    )

    result: dict[str, Any] = {"deleted_subject": body.subject_id}
    try:
        idx = ingest.index_courses()
        result["index"] = idx
    except Exception as exc:  # noqa: BLE001
        result["index_error"] = str(exc)

    return result


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

    # Remove chapter from taxonomy (the subject stays, even if empty — it can
    # only be removed via the explicit subject-delete endpoint).
    chapters.remove(chapter)

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
# NotebookLM automated generation (PDF slides -> course markdown)
# ---------------------------------------------------------------------------

@app.get("/api/notebooklm/status")
async def notebooklm_status() -> dict[str, Any]:
    state = notebooklm_gen.get_auth_state()
    # First call after boot: state is still "unknown" — kick off the background probe
    # and return the current snapshot immediately so the UI can poll.
    if state.get("status") == "unknown":
        asyncio.create_task(notebooklm_gen.ensure_auth_ready())
    return {
        "authenticated": bool(state.get("authenticated")),
        "message": state.get("message", ""),
        "status": state.get("status", "unknown"),
        "last_check": state.get("last_check"),
    }


@app.post("/api/notebooklm/refresh")
async def notebooklm_refresh() -> dict[str, Any]:
    state = await notebooklm_gen.ensure_auth_ready(force=True)
    return {
        "authenticated": bool(state.get("authenticated")),
        "message": state.get("message", ""),
        "status": state.get("status"),
        "last_check": state.get("last_check"),
    }


@app.post("/api/notebooklm/generate")
async def notebooklm_generate(
    file: UploadFile,
    subject_title: str = Form(...),
    chapter_title: str = Form(...),
    reindex: str = Form("true"),
) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(422, "No file provided")
    content = await file.read()
    do_reindex = reindex.lower() in ("true", "1", "yes")
    task_id = notebooklm_gen.create_task()
    asyncio.create_task(
        notebooklm_gen.run_generation(
            task_id,
            content,
            file.filename,
            subject_title.strip(),
            chapter_title.strip(),
            do_reindex,
        )
    )
    return {"task_id": task_id}


@app.get("/api/notebooklm/task/{task_id}")
def notebooklm_task(task_id: str) -> dict[str, Any]:
    t = notebooklm_gen.get_task(task_id)
    if t is None:
        raise HTTPException(404, "Task not found")
    return t


class QuizRegenBody(BaseModel):
    subject_id: str
    chapter_id: str


@app.post("/api/questions/generate-notebooklm")
async def questions_generate_notebooklm(body: QuizRegenBody) -> dict[str, str]:
    """Regenerate the quiz bank for an existing chapter using NotebookLM."""
    tax_path = SUBJECTS_ROOT / "taxonomy.yaml"
    if not tax_path.exists():
        raise HTTPException(404, "taxonomy.yaml not found")
    tax = yaml.safe_load(tax_path.read_text(encoding="utf-8")) or {}
    subj = next((s for s in tax.get("subjects", []) if s["id"] == body.subject_id), None)
    if not subj:
        raise HTTPException(404, f"Subject '{body.subject_id}' not found")
    chapter = next((c for c in subj.get("chapters", []) if c["id"] == body.chapter_id), None)
    if not chapter:
        raise HTTPException(404, f"Chapter '{body.chapter_id}' not found")

    task_id = notebooklm_gen.create_task()
    asyncio.create_task(
        notebooklm_gen.run_quiz_regeneration(
            task_id,
            body.subject_id,
            str(subj.get("title") or body.subject_id),
            body.chapter_id,
            str(chapter.get("title") or body.chapter_id),
        )
    )
    return {"task_id": task_id}


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


# ---------------------------------------------------------------------------
# Interview bank (curated Q/A from youssefHosni/Data-Science-Interview-Questions-Answers)
# ---------------------------------------------------------------------------

_translation_progress: dict[str, Any] = {
    "running": False,
    "done": 0,
    "total": 0,
    "started_at": None,
    "finished_at": None,
    "error": None,
}


async def _translate_bank_in_background() -> None:
    """Translate untranslated bank rows to French, updating as batches complete."""
    _translation_progress.update(
        running=True, done=0, total=0,
        started_at=datetime.utcnow().isoformat(), finished_at=None, error=None,
    )
    try:
        rows = store.list_untranslated_questions()
        _translation_progress["total"] = len(rows)
        batch_size = 10
        for start in range(0, len(rows), batch_size):
            chunk = rows[start : start + batch_size]
            # Translate only the natural-language prefix — anything after the
            # first blank line (image, table) must be preserved verbatim.
            split = [interview_bank.split_question_body(r["question"]) for r in chunk]
            texts = [s[0] for s in split]
            try:
                fr = await interview_bank._translate_batch(texts)
            except Exception:
                fr = texts
            if len(fr) == len(chunk):
                merged = [
                    f"{fr_text}\n\n{att}" if att else fr_text
                    for fr_text, (_, att) in zip(fr, split)
                ]
                store.update_bank_questions(
                    [(r["id"], t) for r, t in zip(chunk, merged)]
                )
            _translation_progress["done"] = start + len(chunk)
    except Exception as exc:
        _translation_progress["error"] = str(exc)
    finally:
        _translation_progress["running"] = False
        _translation_progress["finished_at"] = datetime.utcnow().isoformat()


@app.post("/api/interview/bank/import")
async def interview_bank_import() -> dict[str, Any]:
    """Fetch + parse upstream repo; insert English rows; translate in background."""
    if _translation_progress.get("running"):
        raise HTTPException(status_code=409, detail="Traduction déjà en cours.")
    data = await interview_bank.fetch_and_parse_all(translate=False)
    result = store.replace_interview_bank(data["items"])
    pending = len(store.list_untranslated_questions())
    translation_state = "idle"
    if pending > 0:
        _translation_progress.update(
            running=True, done=0, total=pending, error=None,
        )
        asyncio.create_task(_translate_bank_in_background())
        translation_state = "pending"
    return {
        "inserted": result["inserted"],
        "preserved": result.get("preserved", 0),
        "deleted": result.get("deleted", 0),
        "topics": data["topics"],
        "translation": translation_state,
    }


@app.get("/api/interview/topics")
def interview_topics() -> list[dict[str, Any]]:
    return store.interview_topics()


@app.get("/api/interview/bank/status")
def interview_bank_status() -> dict[str, Any]:
    return {
        "count": store.interview_bank_count(),
        "topics": store.interview_topics(),
        "translation": dict(_translation_progress),
    }


@app.get("/api/interview/question/random")
def interview_question_random(topic: str | None = None) -> dict[str, Any]:
    q = store.random_interview_question(topic=topic)
    if not q:
        raise HTTPException(
            status_code=404,
            detail="Banque vide. Importez d'abord avec POST /api/interview/bank/import.",
        )
    return q


class InterviewHintBody(BaseModel):
    question: str
    reference_answer: str
    user_answer: str = ""


@app.post("/api/interview/open/hint")
async def interview_open_hint(body: InterviewHintBody) -> dict[str, str]:
    """Return a short guiding hint without revealing the answer."""
    partial = body.user_answer.strip()
    partial_block = (
        f"Début de la réponse du candidat :\n{partial}\n\n" if partial else ""
    )
    system = (
        "Tu es un coach d'entretien data science. Tu aides le candidat à progresser sans jamais "
        "lui donner la réponse. Réponds en français, en 2 phrases maximum. Ton indice doit pointer "
        "vers un concept clé ou une piste de raisonnement, sans citer directement la solution de "
        "référence ni lister les points attendus."
    )
    prompt = f"""Question posée :
{body.question}

Réponse de référence (NE PAS la divulguer, même partiellement) :
{body.reference_answer}

{partial_block}Donne un indice court et utile (2 phrases max). Pas de liste. Pas de révélation."""
    hint = await ollama.generate(prompt, system=system, temperature=0.5)
    return {"hint": hint.strip()}


class InterviewGradeBody(BaseModel):
    question: str
    reference_answer: str
    user_answer: str
    bank_id: int | None = None
    topic: str | None = None


@app.post("/api/interview/open/grade")
async def interview_open_grade(body: InterviewGradeBody) -> dict[str, Any]:
    """Strict critical evaluation of the candidate's open answer."""
    system = (
        "Tu es un intervieweur senior en data science, exigeant et direct mais constructif. "
        "Tu évalues strictement la réponse du candidat par rapport à une réponse de référence. "
        "Tu identifies les points corrects, les omissions, les erreurs factuelles, et tu enrichis "
        "avec les subtilités attendues. Tu réponds UNIQUEMENT avec un objet JSON valide, en français."
    )
    prompt = f"""Question :
{body.question}

Réponse de référence :
{body.reference_answer}

Réponse du candidat :
{body.user_answer}

Évalue strictement. Retourne un JSON strict au format :
{{
  "score": <entier 0-10>,
  "verdict": "<une phrase de synthèse>",
  "points_corrects": ["..."],
  "points_manquants": ["..."],
  "erreurs": ["..."],
  "enrichissement": "<paragraphe qui ajoute des subtilités, pièges classiques, ou nuances importantes>"
}}

Sois strict : on note sur 10, pas de complaisance. Un candidat qui oublie un concept clé ne dépasse pas 6/10."""
    raw = await ollama.generate(prompt, system=system, temperature=0.3, force_json=True)

    evaluation: dict[str, Any]
    try:
        evaluation = json.loads(raw)
        if not isinstance(evaluation, dict):
            raise ValueError("not a json object")
    except (json.JSONDecodeError, ValueError):
        evaluation = {
            "score": None,
            "verdict": "Évaluation brute (format JSON invalide)",
            "points_corrects": [],
            "points_manquants": [],
            "erreurs": [],
            "enrichissement": raw.strip(),
        }

    score = evaluation.get("score")
    try:
        score_val = float(score) if score is not None else None
    except (TypeError, ValueError):
        score_val = None

    attempt_id: int | None = None
    if body.topic:
        attempt_id = store.record_interview_attempt(
            bank_id=body.bank_id,
            topic=body.topic,
            question=body.question,
            reference_answer=body.reference_answer,
            user_answer=body.user_answer,
            score=score_val,
            evaluation=evaluation,
        )

    return {"evaluation": evaluation, "attempt_id": attempt_id}


@app.get("/api/interview/history")
def interview_history(topic: str | None = None) -> list[dict[str, Any]]:
    return store.interview_history(topic=topic)


@app.get("/api/interview/attempt/{attempt_id}")
def interview_attempt(attempt_id: int) -> dict[str, Any]:
    d = store.interview_attempt_detail(attempt_id)
    if not d:
        raise HTTPException(status_code=404, detail="Tentative introuvable")
    return d
