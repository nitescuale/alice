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
            """
        )
        # Additive migration for hint + per-option rationales (NotebookLM-sourced quizzes).
        existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(question_bank)")}
        if "hint" not in existing_cols:
            conn.execute("ALTER TABLE question_bank ADD COLUMN hint TEXT")
        if "rationales" not in existing_cols:
            conn.execute("ALTER TABLE question_bank ADD COLUMN rationales TEXT")


@contextmanager
def get_conn():
    conn = sqlite3.connect(str(SQLITE_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def record_quiz_attempt(chapter_id: str, score: float, total: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO quiz_attempts (chapter_id, score, total, created_at) VALUES (?,?,?,?)",
            (chapter_id, score, total, datetime.utcnow().isoformat()),
        )


def quiz_history(chapter_id: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if chapter_id:
            cur = conn.execute(
                "SELECT * FROM quiz_attempts WHERE chapter_id = ? ORDER BY id DESC LIMIT 50",
                (chapter_id,),
            )
        else:
            cur = conn.execute("SELECT * FROM quiz_attempts ORDER BY id DESC LIMIT 100")
        return [dict(r) for r in cur.fetchall()]


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


def banks_summary(subject_id: str) -> list[dict[str, Any]]:
    """Return [{chapter_id, count}] for all chapters of a subject that have banks."""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT chapter_id, COUNT(*) AS count FROM question_bank "
            "WHERE subject_id = ? GROUP BY chapter_id ORDER BY chapter_id ASC",
            (subject_id,),
        )
        return [{"chapter_id": r["chapter_id"], "count": int(r["count"])} for r in cur.fetchall()]
