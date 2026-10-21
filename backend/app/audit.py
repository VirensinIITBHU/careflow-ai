"""Append-only, hash-chained audit log. Each row's hash covers the previous row's hash, so editing
or deleting any past row breaks verification. Details must never contain patient text."""
import hashlib
import json
import sqlite3
from datetime import datetime, timezone

from .schemas import now

GENESIS = "0" * 64


def recently(c: sqlite3.Connection, actor: str, action: str, case_id: str, seconds: int = 600) -> bool:
    """Whether this actor logged the same action for this case within the de-duplication window."""
    row = c.execute("SELECT ts FROM audit WHERE actor=? AND action=? AND case_id=? ORDER BY seq DESC LIMIT 1",
                    (actor, action, case_id)).fetchone()
    if not row:
        return False
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(row["ts"])).total_seconds()
    return age < seconds


def _digest(prev: str, ts: str, actor: str, role: str, action: str, case_id, details: str) -> str:
    return hashlib.sha256("|".join([prev, ts, actor, role, action, str(case_id), details]).encode()).hexdigest()


def append(c: sqlite3.Connection, actor: str, role: str, action: str, case_id=None, details=None) -> None:
    row = c.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
    prev = row["hash"] if row else GENESIS
    ts, d = now(), json.dumps(details or {}, sort_keys=True, ensure_ascii=False)
    c.execute(
        "INSERT INTO audit(ts,actor,role,action,case_id,details,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?)",
        (ts, actor, role, action, case_id, d, prev, _digest(prev, ts, actor, role, action, case_id, d)),
    )


def for_case(c: sqlite3.Connection, case_id: str) -> list[dict]:
    rows = c.execute("SELECT seq,ts,actor,role,action,details FROM audit WHERE case_id=? ORDER BY seq", (case_id,))
    return [{"seq": r["seq"], "timestamp": r["ts"], "actor": r["actor"], "role": r["role"],
             "action": r["action"], "details": json.loads(r["details"])} for r in rows]


def verify(c: sqlite3.Connection) -> dict:
    prev, n = GENESIS, 0
    for r in c.execute("SELECT * FROM audit ORDER BY seq"):
        if r["prev_hash"] != prev or r["hash"] != _digest(prev, r["ts"], r["actor"], r["role"], r["action"],
                                                          r["case_id"], r["details"]):
            return {"ok": False, "checked": n, "broken_at_seq": r["seq"]}
        prev, n = r["hash"], n + 1
    return {"ok": True, "checked": n, "broken_at_seq": None}
