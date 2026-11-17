"""Live updates (server-sent events), operational metrics and the rule-benchmark endpoint."""
import asyncio
import json
import statistics
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from .. import config, db
from ..auth import User, require
from ..schemas import Case
from .cases import intake_view

router = APIRouter(tags=["insights"])
STAFF = require("reviewer", "admin")


def _token_user(token: str) -> User:
    row = db.session_user(token) if token else None
    if row is None:
        raise HTTPException(401, "Sign in required")
    return User(username=row["username"], role=row["role"])


def _progress(user: User, case: Case) -> dict:
    base = intake_view(case)
    if user.role in ("reviewer", "admin"):
        base.update({"effective_tier": None if case.status == "processing" else case.effective_tier,
                     "open_flags": case.open_flags, "updated_at": case.updated_at})
    return base


def _sse(data: dict, event: str = "message") -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/cases/{case_id}/events")
async def case_events(case_id: str, request: Request, token: str = ""):
    """Streams progress for one case until processing finishes. EventSource cannot send headers, so the session
    token is passed as a query parameter."""
    user = _token_user(token)

    def read():
        c = db.connect()
        try:
            return db.get_case(c, case_id)
        finally:
            c.close()

    case = await asyncio.to_thread(read)
    if case is None or case.status == "withdrawn" or (user.role == "intake" and case.created_by != user.username):
        raise HTTPException(404, "Case not found")

    async def gen():
        last, beat, started = None, time.time(), time.time()
        yield "retry: 2000\n\n"
        while time.time() - started < 600:
            if await request.is_disconnected():
                return
            cur = await asyncio.to_thread(read)
            if cur is None or cur.status == "withdrawn":
                yield _sse({"status": "withdrawn"}, "done")
                return
            if cur.updated_at != last:
                last = cur.updated_at
                yield _sse(_progress(user, cur), "progress")
                if cur.status != "processing":
                    yield _sse({"status": cur.status}, "done")
                    return
            if time.time() - beat > 15:
                beat = time.time()
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/queue/events")
async def queue_events(request: Request, token: str = ""):
    """Emits a 'changed' event whenever any case changes, so reviewer screens refresh in real time."""
    user = _token_user(token)
    if user.role not in ("reviewer", "admin"):
        raise HTTPException(403, "Reviewer access required")

    def stamp():
        c = db.connect()
        try:
            r = c.execute("SELECT MAX(updated_at) AS m, COUNT(*) AS n FROM cases").fetchone()
            return f"{r['m']}|{r['n']}"
        finally:
            c.close()

    async def gen():
        last, beat = await asyncio.to_thread(stamp), time.time()
        yield "retry: 3000\n\n"
        yield _sse({"stamp": last}, "hello")
        while True:
            if await request.is_disconnected():
                return
            cur = await asyncio.to_thread(stamp)
            if cur != last:
                last = cur
                yield _sse({"stamp": cur}, "changed")
            if time.time() - beat > 15:
                beat = time.time()
                yield ": keep-alive\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _minutes(a: str | None, b: str | None) -> float | None:
    if not a or not b:
        return None
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 60


@router.get("/metrics")
def metrics(user: User = Depends(STAFF)):
    c = db.connect()
    try:
        cases = db.all_cases(c)
        sessions = c.execute("SELECT status, COUNT(*) n FROM interview_sessions GROUP BY status").fetchall()
    finally:
        c.close()
    status = Counter(x.status for x in cases)
    open_cases = [x for x in cases if x.status in ("needs_review", "in_review")]
    to_decision = [m for x in cases if (m := _minutes(x.created_at, x.reviewed_at)) is not None and m >= 0]
    to_ready = [m * 60 for x in cases if (m := _minutes(x.created_at, x.processed_at)) is not None and 0 <= m < 60]
    stage_ms: dict[str, list[int]] = defaultdict(list)
    for x in cases:
        for s in x.stages:
            if s.status == "done" and s.ms:
                stage_ms[s.name].append(s.ms)
    today = datetime.now(timezone.utc).date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    per_day = Counter(x.created_at[:10] for x in cases)
    flags = Counter(f.title for x in cases for f in x.flags if f.kind == "safety")
    langs = Counter(lang for x in cases for lang in (x.detected_languages or ["unknown"]))
    iv = [x for x in cases if x.interview]
    by_origin: dict[str, Counter] = defaultdict(Counter)
    for x in iv:
        for r in x.interview:
            by_origin[r["question"]["origin"]][r["status"]] += 1
    return {
        "totals": {"cases": len(cases), **{k: status.get(k, 0) for k in
                                          ("processing", "needs_review", "in_review", "approved", "rejected")},
                   "consulted": sum(1 for x in cases if x.consulted_at),
                   "archived": sum(1 for x in cases if x.archived_at)},
        "open_by_tier": {t: sum(1 for x in open_cases if x.effective_tier == t)
                         for t in ("immediate", "urgent", "undetermined", "standard")},
        "oldest_open_minutes": round(max((_minutes(x.created_at, datetime.now(timezone.utc).isoformat()) or 0
                                          for x in open_cases), default=0), 1),
        "minutes_to_decision": {"median": round(statistics.median(to_decision), 1) if to_decision else None,
                                "count": len(to_decision)},
        "seconds_to_ready": {"median": round(statistics.median(to_ready), 1) if to_ready else None,
                             "count": len(to_ready)},
        "stage_ms": {k: {"median": int(statistics.median(v)), "count": len(v)} for k, v in sorted(stage_ms.items())},
        "cases_per_day": [{"day": d, "count": per_day.get(d, 0)} for d in days],
        "top_warning_signs": [{"title": k, "count": v} for k, v in flags.most_common(8)],
        "languages": [{"language": k, "count": v} for k, v in langs.most_common(8)],
        "interview": {
            "cases": len(iv), "share": round(100 * len(iv) / len(cases)) if cases else 0,
            "sessions": {r["status"]: r["n"] for r in sessions},
            "avg_answered": round(sum(sum(1 for r in x.interview if r["status"] == "answered") for x in iv)
                                  / len(iv), 1) if iv else 0,
            "by_origin": {k: dict(v) for k, v in by_origin.items()},
        },
    }


@router.get("/eval/rules")
def eval_rules(user: User = Depends(STAFF)):
    """Runs the offline synthetic rule benchmark live (no model calls). A software regression check only:
    it is not a clinical accuracy measure."""
    from ..safety.engine import outcome
    path = config.BASE.parent / "eval" / "cases" / "safety_cases.json"
    if not path.exists():
        raise HTTPException(404, "Benchmark file not found")
    cases = json.loads(path.read_text(encoding="utf-8"))
    t0 = time.time()
    groups, langs, fails = defaultdict(list), defaultdict(list), []
    for case in cases:
        got = outcome(case["text"])
        exp = case["expect"]
        if exp == "none":
            ok = not got
        else:
            kind, cat = exp.split(":")
            ok = exp in got and (kind == "current" or f"current:{cat}" not in got)
        groups[exp.split(":")[0]].append(ok)
        langs[case["lang"]].append(ok)
        if not ok:
            fails.append({"id": case["id"], "lang": case["lang"], "expect": exp, "got": sorted(got),
                          "text": case["text"]})
    summary = lambda r: {"passed": sum(r), "total": len(r)}  # noqa: E731
    return {"cases": len(cases), "ms": int((time.time() - t0) * 1000),
            "groups": {"current": summary(groups["current"]), "context": summary(groups["context"]),
                       "none": summary(groups["none"])},
            "languages": {k: summary(v) for k, v in sorted(langs.items())},
            "failures": fails[:20], "clinically_validated": False}
