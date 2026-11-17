"""SQLite persistence: case documents (+ indexed status/tier), sessions, and the audit table."""
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from . import config
from .schemas import TIER_RANK, Case, InterviewSession, now

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases(
  case_id TEXT PRIMARY KEY, status TEXT NOT NULL, tier_rank INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL,
  action TEXT NOT NULL, case_id TEXT, details TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit(case_id);
CREATE TABLE IF NOT EXISTS interview_sessions(
  session_id TEXT PRIMARY KEY, created_by TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, doc TEXT NOT NULL);
"""


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class Withdrawn(Exception):
    pass


def connect() -> sqlite3.Connection:
    Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(config.DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=10000")
    return c


def init() -> None:
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    c = connect()
    try:
        c.executescript(SCHEMA)
    finally:
        c.close()


@contextmanager
def tx():
    """One write transaction (BEGIN IMMEDIATE): state check and write are atomic."""
    c = connect()
    try:
        c.execute("BEGIN IMMEDIATE")
        yield c
        c.commit()
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()


def get_case(c: sqlite3.Connection, case_id: str) -> Optional[Case]:
    row = c.execute("SELECT doc FROM cases WHERE case_id=?", (case_id,)).fetchone()
    return Case.model_validate_json(row["doc"]) if row else None


def put_case(c: sqlite3.Connection, case: Case) -> None:
    c.execute(
        "INSERT INTO cases(case_id,status,tier_rank,created_at,updated_at,doc) VALUES(?,?,?,?,?,?) "
        "ON CONFLICT(case_id) DO UPDATE SET status=excluded.status, tier_rank=excluded.tier_rank, "
        "updated_at=excluded.updated_at, doc=excluded.doc",
        (case.case_id, case.status, TIER_RANK[case.effective_tier], case.created_at, case.updated_at,
         case.model_dump_json()),
    )


def update(case_id: str, fn: Callable[[Case, sqlite3.Connection], None], allowed: Optional[set] = None) -> Case:
    """Load, check status, mutate via fn(case, conn), save. fn may raise Conflict."""
    with tx() as c:
        case = get_case(c, case_id)
        if case is None or case.status == "withdrawn":
            raise NotFound(case_id)
        if allowed and case.status not in allowed:
            raise Conflict(f"Case is '{case.status}'; this action needs {' or '.join(sorted(allowed))}.")
        fn(case, c)
        case.updated_at = now()
        put_case(c, case)
        return case


def new_session(c: sqlite3.Connection, username: str, role: str) -> str:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=config.SESSION_TTL_HOURS)).isoformat()
    c.execute("DELETE FROM sessions WHERE created_at < ?", (cutoff,))
    token = secrets.token_urlsafe(24)
    c.execute("INSERT INTO sessions VALUES(?,?,?,?)", (token, username, role, now()))
    return token


def session_user(token: str) -> Optional[sqlite3.Row]:
    c = connect()
    try:
        row = c.execute("SELECT username, role, created_at FROM sessions WHERE token=?", (token,)).fetchone()
    finally:
        c.close()

    if row is None:
        return None
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(row["created_at"])).total_seconds()
    if age < 0 or age >= config.SESSION_TTL_HOURS * 3600:
        return None
    return row


def delete_session(c: sqlite3.Connection, token: str) -> None:
    c.execute("DELETE FROM sessions WHERE token=?", (token,))


def get_session(c: sqlite3.Connection, session_id: str) -> Optional[InterviewSession]:
    row = c.execute("SELECT doc FROM interview_sessions WHERE session_id=?", (session_id,)).fetchone()
    return InterviewSession.model_validate_json(row["doc"]) if row else None


def put_session(c: sqlite3.Connection, s: InterviewSession) -> None:
    s.updated_at = now()
    c.execute(
        "INSERT INTO interview_sessions(session_id,created_by,status,created_at,updated_at,doc) VALUES(?,?,?,?,?,?) "
        "ON CONFLICT(session_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, doc=excluded.doc",
        (s.session_id, s.created_by, s.status, s.created_at, s.updated_at, s.model_dump_json()))


def all_cases(c: sqlite3.Connection) -> list[Case]:
    return [Case.model_validate_json(r["doc"]) for r in c.execute("SELECT doc FROM cases WHERE status != 'withdrawn'")]
