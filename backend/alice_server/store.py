"""SQLite: progression quiz et chapitres."""

from __future__ import annotations

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
            """
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
