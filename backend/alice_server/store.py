"""SQLite: progression quiz et chapitres."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from alice_server.config import SQLITE_PATH


def init_db() -> None:
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS chapter_progress (
                chapter_id TEXT PRIMARY KEY,
                last_read_at TEXT,
                visits INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chapter_id TEXT,
                score REAL,
                total INTEGER,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS interview_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company TEXT,
                score REAL,
                notes TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS question_bank (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                q TEXT NOT NULL,
                options TEXT NOT NULL,
                correct INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_qb_chapter ON question_bank(subject_id, chapter_id);
            CREATE TABLE IF NOT EXISTS interview_bank (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT NOT NULL,
                topic_label TEXT NOT NULL,
                source_path TEXT NOT NULL,
                idx INTEGER NOT NULL,
                question TEXT NOT NULL,
                reference_answer TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(topic, idx, source_path)
            );
            CREATE INDEX IF NOT EXISTS idx_ib_topic ON interview_bank(topic);
            CREATE TABLE IF NOT EXISTS interview_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bank_id INTEGER,
                topic TEXT NOT NULL,
                question TEXT NOT NULL,
                reference_answer TEXT NOT NULL,
                user_answer TEXT NOT NULL,
                score REAL,
                evaluation TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ia_topic ON interview_attempts(topic);
            CREATE TABLE IF NOT EXISTS podcast_transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                spotify_url TEXT NOT NULL UNIQUE,
                spotify_episode_id TEXT NOT NULL,
                show_name TEXT NOT NULL,
                episode_title TEXT NOT NULL,
                published_at TEXT,
                duration_sec INTEGER,
                language TEXT,
                audio_url TEXT,
                segments_json TEXT NOT NULL DEFAULT '[]',
                full_text TEXT NOT NULL DEFAULT '',
                model_used TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pt_show ON podcast_transcripts(show_name);
            """
        )
        # Additive migration for hint + per-option rationales (NotebookLM-sourced quizzes).
        existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(question_bank)")}
        if "hint" not in existing_cols:
            conn.execute("ALTER TABLE question_bank ADD COLUMN hint TEXT")
        if "rationales" not in existing_cols:
            conn.execute("ALTER TABLE question_bank ADD COLUMN rationales TEXT")
        # Additive migration: per-attempt snapshot (questions, user answers, hints, rationales).
        existing_cols_qa = {r["name"] for r in conn.execute("PRAGMA table_info(quiz_attempts)")}
        if "details" not in existing_cols_qa:
            conn.execute("ALTER TABLE quiz_attempts ADD COLUMN details TEXT")
        # Additive migration: keep the original English question so re-imports
        # can preserve translations we already paid for. Empty string means
        # "unknown" and gets back-filled on the next replace_interview_bank.
        existing_cols_ib = {r["name"] for r in conn.execute("PRAGMA table_info(interview_bank)")}
        if "question_en" not in existing_cols_ib:
            conn.execute("ALTER TABLE interview_bank ADD COLUMN question_en TEXT NOT NULL DEFAULT ''")
        if "reference_answer_en" not in existing_cols_ib:
            conn.execute(
                "ALTER TABLE interview_bank ADD COLUMN reference_answer_en TEXT NOT NULL DEFAULT ''"
            )


@contextmanager
def get_conn():
    conn = sqlite3.connect(str(SQLITE_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def record_quiz_attempt(
    chapter_id: str,
    score: float,
    total: int,
    details: list[dict[str, Any]] | None = None,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO quiz_attempts (chapter_id, score, total, created_at, details) VALUES (?,?,?,?,?)",
            (
                chapter_id,
                score,
                total,
                datetime.utcnow().isoformat(),
                json.dumps(details, ensure_ascii=False) if details else None,
            ),
        )
        return int(cur.lastrowid)


def _strip_attempt_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d.pop("details", None)
    d["has_details"] = bool(row["details"]) if "details" in row.keys() else False
    return d


def quiz_history(chapter_id: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if chapter_id:
            cur = conn.execute(
                "SELECT * FROM quiz_attempts WHERE chapter_id = ? ORDER BY id DESC LIMIT 50",
                (chapter_id,),
            )
        else:
            cur = conn.execute("SELECT * FROM quiz_attempts ORDER BY id DESC LIMIT 100")
        return [_strip_attempt_row(r) for r in cur.fetchall()]


def quiz_attempt_detail(attempt_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        cur = conn.execute("SELECT * FROM quiz_attempts WHERE id = ?", (attempt_id,))
        row = cur.fetchone()
        if not row:
            return None
        result = dict(row)
        raw = result.get("details")
        if raw:
            try:
                result["details"] = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                result["details"] = None
        return result


def touch_chapter(chapter_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO chapter_progress (chapter_id, last_read_at, visits)
            VALUES (?, ?, 1)
            ON CONFLICT(chapter_id) DO UPDATE SET
                last_read_at = excluded.last_read_at,
                visits = chapter_progress.visits + 1
            """,
            (chapter_id, datetime.utcnow().isoformat()),
        )


def chapter_history() -> list[dict[str, Any]]:
    """Return all visited chapters ordered by most recently read."""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT chapter_id, last_read_at AS completed_at, visits FROM chapter_progress ORDER BY last_read_at DESC LIMIT 200"
        )
        return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Question bank
# ---------------------------------------------------------------------------

def insert_questions(
    subject_id: str, chapter_id: str, questions: list[dict[str, Any]]
) -> int:
    """Bulk insert questions into the bank. Returns the number of rows inserted."""
    if not questions:
        return 0
    now = datetime.utcnow().isoformat()
    rows = []
    for q in questions:
        opts = q.get("options", [])
        rationales = q.get("rationales")
        hint = q.get("hint")
        rows.append(
            (
                subject_id,
                chapter_id,
                str(q.get("q", "")),
                json.dumps(opts, ensure_ascii=False),
                int(q.get("correct", 0)),
                now,
                hint if isinstance(hint, str) and hint else None,
                json.dumps(rationales, ensure_ascii=False) if isinstance(rationales, list) else None,
            )
        )
    with get_conn() as conn:
        conn.executemany(
            "INSERT INTO question_bank (subject_id, chapter_id, q, options, correct, created_at, hint, rationales) "
            "VALUES (?,?,?,?,?,?,?,?)",
            rows,
        )
    return len(rows)


def clear_bank(subject_id: str, chapter_id: str) -> None:
    """Delete all bank rows for a given (subject, chapter)."""
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM question_bank WHERE subject_id = ? AND chapter_id = ?",
            (subject_id, chapter_id),
        )


def bank_count(subject_id: str, chapter_id: str) -> int:
    """Count questions stored in the bank for a chapter."""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT COUNT(*) AS n FROM question_bank WHERE subject_id = ? AND chapter_id = ?",
            (subject_id, chapter_id),
        )
        row = cur.fetchone()
        return int(row["n"]) if row else 0


_BANK_SELECT_COLS = "q, options, correct, hint, rationales"


def _row_to_question(row: sqlite3.Row) -> dict[str, Any]:
    try:
        opts = json.loads(row["options"])
    except (TypeError, json.JSONDecodeError):
        opts = []
    rationales: list[str] = []
    raw_rat = row["rationales"] if "rationales" in row.keys() else None
    if raw_rat:
        try:
            parsed = json.loads(raw_rat)
            if isinstance(parsed, list):
                rationales = [str(x) for x in parsed]
        except (TypeError, json.JSONDecodeError):
            pass
    hint = row["hint"] if "hint" in row.keys() else None
    return {
        "q": row["q"],
        "options": opts if isinstance(opts, list) else [],
        "correct": int(row["correct"]),
        "hint": hint or "",
        "rationales": rationales,
    }


def list_bank(subject_id: str, chapter_id: str) -> list[dict[str, Any]]:
    """Return all bank rows for a chapter as {q, options, correct, hint, rationales} dicts."""
    with get_conn() as conn:
        cur = conn.execute(
            f"SELECT {_BANK_SELECT_COLS} FROM question_bank "
            "WHERE subject_id = ? AND chapter_id = ? ORDER BY id ASC",
            (subject_id, chapter_id),
        )
        return [_row_to_question(r) for r in cur.fetchall()]


def sample_bank(
    subject_id: str, chapter_id: str | None, n: int
) -> list[dict[str, Any]]:
    """Random sample of `n` questions. If chapter_id is None, sample across the subject."""
    n = max(0, int(n))
    if n == 0:
        return []
    with get_conn() as conn:
        if chapter_id:
            cur = conn.execute(
                f"SELECT {_BANK_SELECT_COLS} FROM question_bank "
                "WHERE subject_id = ? AND chapter_id = ? ORDER BY RANDOM() LIMIT ?",
                (subject_id, chapter_id, n),
            )
        else:
            cur = conn.execute(
                f"SELECT {_BANK_SELECT_COLS} FROM question_bank "
                "WHERE subject_id = ? ORDER BY RANDOM() LIMIT ?",
                (subject_id, n),
            )
        return [_row_to_question(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Interview bank
# ---------------------------------------------------------------------------

def _split_question_body(text: str) -> tuple[str, str]:
    """Split a question into (natural-language text, attachment block)
    at the first blank line. Attachment is the image/table verbatim block
    that must be carried across re-imports without re-translation."""
    idx = text.find("\n\n")
    if idx < 0:
        return text, ""
    return text[:idx].rstrip(), text[idx + 2:]


def replace_interview_bank(items: list[dict[str, Any]]) -> dict[str, int]:
    """Upsert the bank, preserving translations for rows whose English didn't change.

    Returns {"inserted": N_new, "preserved": N_reused, "deleted": N_stale,
    "topics": K}. "inserted" rows still need translation; "preserved" rows
    keep their French translation but pick up any new attachment (image/table)
    from the fresh parse.
    """
    now = datetime.utcnow().isoformat()
    inserted = preserved = 0
    with get_conn() as conn:
        # Snapshot existing rows keyed by the natural identity triple.
        existing: dict[tuple[str, int, str], dict[str, Any]] = {}
        for r in conn.execute(
            "SELECT topic, idx, source_path, question, question_en, "
            "reference_answer, reference_answer_en FROM interview_bank"
        ):
            existing[(r["topic"], int(r["idx"]), r["source_path"])] = {
                "question": r["question"],
                "question_en": r["question_en"] or "",
                "reference_answer": r["reference_answer"],
                "reference_answer_en": r["reference_answer_en"] or "",
            }

        incoming_keys: set[tuple[str, int, str]] = set()
        for it in items:
            topic = it["topic"]
            idx = int(it.get("idx", 0))
            source_path = it.get("source_path", "")
            key = (topic, idx, source_path)
            incoming_keys.add(key)
            en = it["question"]
            prev = existing.get(key)
            # Reuse the existing French translation whenever the natural-
            # language text of the English question hasn't changed. We
            # compare *text only*, not the attachment block, so a newly
            # extracted image/table doesn't force re-translation. Pre-
            # migration rows (empty question_en) also take this path.
            prev_en_text, _ = _split_question_body(prev["question_en"]) if prev else ("", "")
            en_text, en_att = _split_question_body(en)
            ans_en = it["reference_answer"]
            prev_ans_en_text, _ = (
                _split_question_body(prev["reference_answer_en"]) if prev else ("", "")
            )
            ans_en_text, ans_en_att = _split_question_body(ans_en)
            if prev is not None and (prev_en_text == en_text or not prev["question_en"]):
                fr_text, _ = _split_question_body(prev["question"])
                new_question = f"{fr_text}\n\n{en_att}" if en_att else fr_text
                # Same preserve logic for the answer: keep the French body if
                # the English text didn't change, swap in the fresh attachment.
                if prev["reference_answer_en"] and prev_ans_en_text == ans_en_text:
                    fr_ans_text, _ = _split_question_body(prev["reference_answer"])
                    new_answer = f"{fr_ans_text}\n\n{ans_en_att}" if ans_en_att else fr_ans_text
                else:
                    new_answer = ans_en
                conn.execute(
                    "UPDATE interview_bank "
                    "SET question = ?, reference_answer = ?, topic_label = ?, "
                    "question_en = ?, reference_answer_en = ? "
                    "WHERE topic = ? AND idx = ? AND source_path = ?",
                    (new_question, new_answer, it.get("topic_label", topic),
                     en, ans_en, topic, idx, source_path),
                )
                preserved += 1
            else:
                conn.execute(
                    "DELETE FROM interview_bank "
                    "WHERE topic = ? AND idx = ? AND source_path = ?",
                    (topic, idx, source_path),
                )
                conn.execute(
                    "INSERT INTO interview_bank "
                    "(topic, topic_label, source_path, idx, question, question_en, "
                    "reference_answer, reference_answer_en, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (topic, it.get("topic_label", topic), source_path, idx,
                     en, en, ans_en, ans_en, now),
                )
                inserted += 1

        # Drop rows the upstream no longer serves.
        stale = [k for k in existing if k not in incoming_keys]
        for k in stale:
            conn.execute(
                "DELETE FROM interview_bank WHERE topic = ? AND idx = ? AND source_path = ?",
                k,
            )

    topics = {it["topic"] for it in items}
    return {
        "inserted": inserted,
        "preserved": preserved,
        "deleted": len(stale),
        "topics": len(topics),
    }


def interview_topics() -> list[dict[str, Any]]:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT topic, MAX(topic_label) AS label, COUNT(*) AS count "
            "FROM interview_bank GROUP BY topic ORDER BY label ASC"
        )
        return [
            {"slug": r["topic"], "label": r["label"], "count": int(r["count"])}
            for r in cur.fetchall()
        ]


def interview_bank_count() -> int:
    with get_conn() as conn:
        cur = conn.execute("SELECT COUNT(*) AS n FROM interview_bank")
        row = cur.fetchone()
        return int(row["n"]) if row else 0


def list_bank_questions_minimal() -> list[dict[str, Any]]:
    """Return [{id, question}] for every row, in insertion order."""
    with get_conn() as conn:
        cur = conn.execute("SELECT id, question FROM interview_bank ORDER BY id ASC")
        return [{"id": int(r["id"]), "question": r["question"]} for r in cur.fetchall()]


def list_untranslated_questions() -> list[dict[str, Any]]:
    """Return [{id, question}] only for rows whose `question` still equals the
    original English (i.e. the translation pass hasn't touched them yet)."""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT id, question FROM interview_bank "
            "WHERE question_en != '' AND question = question_en "
            "ORDER BY id ASC"
        )
        return [{"id": int(r["id"]), "question": r["question"]} for r in cur.fetchall()]


def update_bank_questions(updates: list[tuple[int, str]]) -> int:
    """Batch-update the `question` column by row id. Returns rows touched."""
    if not updates:
        return 0
    with get_conn() as conn:
        conn.executemany(
            "UPDATE interview_bank SET question = ? WHERE id = ?",
            [(new_q, row_id) for row_id, new_q in updates],
        )
    return len(updates)


def list_untranslated_answers() -> list[dict[str, Any]]:
    """Return [{id, reference_answer}] for rows whose `reference_answer` still
    equals the original English (translation pass hasn't touched them yet)."""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT id, reference_answer FROM interview_bank "
            "WHERE reference_answer_en != '' AND reference_answer = reference_answer_en "
            "ORDER BY id ASC"
        )
        return [
            {"id": int(r["id"]), "reference_answer": r["reference_answer"]}
            for r in cur.fetchall()
        ]


def update_bank_answers(updates: list[tuple[int, str]]) -> int:
    """Batch-update the `reference_answer` column by row id."""
    if not updates:
        return 0
    with get_conn() as conn:
        conn.executemany(
            "UPDATE interview_bank SET reference_answer = ? WHERE id = ?",
            [(new_a, row_id) for row_id, new_a in updates],
        )
    return len(updates)


def random_interview_question(topic: str | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        if topic:
            cur = conn.execute(
                "SELECT id, topic, topic_label, source_path, idx, "
                "question, question_en, reference_answer, reference_answer_en "
                "FROM interview_bank WHERE topic = ? ORDER BY RANDOM() LIMIT 1",
                (topic,),
            )
        else:
            cur = conn.execute(
                "SELECT id, topic, topic_label, source_path, idx, "
                "question, question_en, reference_answer, reference_answer_en "
                "FROM interview_bank ORDER BY RANDOM() LIMIT 1"
            )
        row = cur.fetchone()
        return dict(row) if row else None


def record_interview_attempt(
    bank_id: int | None,
    topic: str,
    question: str,
    reference_answer: str,
    user_answer: str,
    score: float | None,
    evaluation: dict[str, Any] | None,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO interview_attempts "
            "(bank_id, topic, question, reference_answer, user_answer, score, evaluation, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                bank_id,
                topic,
                question,
                reference_answer,
                user_answer,
                score,
                json.dumps(evaluation, ensure_ascii=False) if evaluation else None,
                datetime.utcnow().isoformat(),
            ),
        )
        return int(cur.lastrowid)


def interview_history(topic: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if topic:
            cur = conn.execute(
                "SELECT id, bank_id, topic, question, score, created_at "
                "FROM interview_attempts WHERE topic = ? ORDER BY id DESC LIMIT ?",
                (topic, int(limit)),
            )
        else:
            cur = conn.execute(
                "SELECT id, bank_id, topic, question, score, created_at "
                "FROM interview_attempts ORDER BY id DESC LIMIT ?",
                (int(limit),),
            )
        return [dict(r) for r in cur.fetchall()]


def interview_attempt_detail(attempt_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT * FROM interview_attempts WHERE id = ?", (attempt_id,)
        )
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        raw = d.get("evaluation")
        if raw:
            try:
                d["evaluation"] = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                d["evaluation"] = None
        return d


# ---------------------------------------------------------------------------
# Podcast transcripts
# ---------------------------------------------------------------------------


def insert_podcast_pending(spotify_url: str, spotify_episode_id: str) -> int:
    """Create the row right after the user submits the URL. Returns the new id.
    Raises sqlite3.IntegrityError if the URL is already in the bank."""
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO podcast_transcripts "
            "(spotify_url, spotify_episode_id, show_name, episode_title, "
            "status, created_at) VALUES (?,?,?,?,?,?)",
            (spotify_url, spotify_episode_id, "", "", "pending", now),
        )
        return int(cur.lastrowid)


def update_podcast_status(
    row_id: int,
    status: str,
    error: str | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE podcast_transcripts SET status = ?, error = ? WHERE id = ?",
            (status, error, row_id),
        )


def update_podcast_metadata(
    row_id: int,
    show_name: str,
    episode_title: str,
    published_at: str | None,
    duration_sec: int | None,
    audio_url: str | None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE podcast_transcripts SET show_name = ?, episode_title = ?, "
            "published_at = ?, duration_sec = ?, audio_url = ? WHERE id = ?",
            (show_name, episode_title, published_at, duration_sec, audio_url, row_id),
        )


def finalize_podcast_transcript(
    row_id: int,
    language: str,
    segments: list[dict[str, Any]],
    model_used: str,
) -> None:
    full_text = "\n".join(seg.get("text", "") for seg in segments).strip()
    with get_conn() as conn:
        conn.execute(
            "UPDATE podcast_transcripts SET segments_json = ?, full_text = ?, "
            "language = ?, model_used = ?, status = 'done', error = NULL "
            "WHERE id = ?",
            (
                json.dumps(segments, ensure_ascii=False),
                full_text,
                language,
                model_used,
                row_id,
            ),
        )


def list_podcast_transcripts() -> list[dict[str, Any]]:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT id, spotify_url, spotify_episode_id, show_name, episode_title, "
            "published_at, duration_sec, language, model_used, status, error, created_at "
            "FROM podcast_transcripts ORDER BY id DESC"
        )
        return [dict(r) for r in cur.fetchall()]


def get_podcast_transcript(row_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT * FROM podcast_transcripts WHERE id = ?", (row_id,)
        )
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["segments"] = json.loads(d.pop("segments_json") or "[]")
        except (TypeError, json.JSONDecodeError):
            d["segments"] = []
        return d


def delete_podcast_transcript(row_id: int) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM podcast_transcripts WHERE id = ?", (row_id,)
        )
        return cur.rowcount


def search_podcast_transcripts(query: str) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    like = f"%{q}%"
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT id, spotify_url, show_name, episode_title, published_at, "
            "duration_sec, language, status, created_at "
            "FROM podcast_transcripts "
            "WHERE status = 'done' AND ("
            "  full_text LIKE ? OR show_name LIKE ? OR episode_title LIKE ?"
            ") ORDER BY id DESC",
            (like, like, like),
        )
        return [dict(r) for r in cur.fetchall()]


def banks_summary(subject_id: str) -> list[dict[str, Any]]:
    """Return [{chapter_id, count}] for all chapters of a subject that have banks."""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT chapter_id, COUNT(*) AS count FROM question_bank "
            "WHERE subject_id = ? GROUP BY chapter_id ORDER BY chapter_id ASC",
            (subject_id,),
        )
        return [{"chapter_id": r["chapter_id"], "count": int(r["count"])} for r in cur.fetchall()]
