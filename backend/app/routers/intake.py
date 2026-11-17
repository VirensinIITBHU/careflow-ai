"""Live interview sessions: consent first, then statements and answers (typed or spoken) while the copilot
suggests the next questions instantly. Submitting a session creates a normal case for the review pipeline.

Intake staff see only what they entered themselves plus copilot questions during the session. After
submission the case follows the usual rules: intake sees operational status only."""
import asyncio
import json
import re
import shutil
import time
from pathlib import Path
from typing import Optional

from fastapi import (APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, WebSocket,
                     WebSocketDisconnect)
from pydantic import BaseModel, Field

from .. import audit, config, db
from ..auth import User, require
from ..copilot import service
from ..pipeline import orchestrator, transcribe
from ..schemas import Consent, InterviewSession, Question, Source, Turn, now
from .cases import AUDIO, CONSENT_VERSION, REPORT, _read, intake_view

router = APIRouter(prefix="/intake/sessions", tags=["interview"])
INTAKE = require("intake", "admin")
MAX_TURNS = 60


class NewSession(BaseModel):
    consent: bool
    language_hint: Optional[str] = Field(None, max_length=30)
    patient_ref: Optional[str] = Field(None, max_length=40)


class Suggest(BaseModel):
    draft: str = Field("", max_length=4000)
    model: bool = True


class Skip(BaseModel):
    key: str = Field(min_length=1, max_length=80)


def _dir(session_id: str) -> Path:
    return config.UPLOAD_DIR / "sessions" / session_id


def _load(session_id: str, user: User) -> InterviewSession:
    c = db.connect()
    try:
        s = db.get_session(c, session_id)
    finally:
        c.close()
    if s is None or (user.role == "intake" and s.created_by != user.username):
        raise HTTPException(404, "Interview not found")
    return s


def _mutate(session_id: str, user: User, fn, active_only: bool = True) -> InterviewSession:
    with db.tx() as c:
        s = db.get_session(c, session_id)
        if s is None or (user.role == "intake" and s.created_by != user.username):
            raise HTTPException(404, "Interview not found")
        if active_only and s.status != "active":
            raise HTTPException(409, f"This interview is already {s.status}.")
        fn(s, c)
        db.put_session(c, s)
        return s


def view(s: InterviewSession) -> dict:
    d = s.model_dump(mode="json", exclude={"shown"})
    for t in d["turns"]:
        t.pop("stored_name", None)
        t.pop("segments", None)
    d["attachments"] = [{"source_id": a["source_id"], "filename": a["filename"]} for a in s.attachments]
    return d


def _with_suggestions(s: InterviewSession, payload: dict | None = None) -> dict:
    payload = payload or service.instant(s)[0]
    return {"session": view(s), "suggestions": payload}


@router.post("", status_code=201)
def start(body: NewSession, user: User = Depends(INTAKE)):
    if not body.consent:
        raise HTTPException(400, "Patient consent must be recorded before the interview starts.")
    ref = (body.patient_ref or "").strip() or None
    if ref and not re.fullmatch(r"[A-Za-z0-9._/-]{1,40}", ref):
        raise HTTPException(400, "Patient reference may contain letters, numbers and . _ / - only, up to 40 characters")
    s = InterviewSession(created_by=user.username, patient_ref=ref,
                         language_hint=(body.language_hint or "").strip()[:30] or None,
                         consent=Consent(obtained=True, version=CONSENT_VERSION, at=now()))
    with db.tx() as c:
        db.put_session(c, s)
        audit.append(c, user.username, user.role, "interview_started", None,
                     {"session_id": s.session_id, "consent_version": CONSENT_VERSION})
    return _with_suggestions(s)


@router.get("/{session_id}")
def get(session_id: str, user: User = Depends(INTAKE)):
    s = _load(session_id, user)
    return _with_suggestions(s) if s.status == "active" else {"session": view(s), "suggestions": None}


@router.post("/{session_id}/suggest")
def suggest(session_id: str, body: Suggest, user: User = Depends(INTAKE)):
    """HTTP fallback for the WebSocket: rules always, plus the model when requested."""
    s = _load(session_id, user)
    if s.status != "active":
        raise HTTPException(409, f"This interview is already {s.status}.")
    payload = service.with_model(s, body.draft) if body.model else service.instant(s, body.draft)[0]
    _mutate(session_id, user, lambda x, c: service.remember(x, payload))
    return payload


@router.post("/{session_id}/turns")
def add_turn(session_id: str, text: Optional[str] = Form(None), question: Optional[str] = Form(None),
             audio: Optional[UploadFile] = File(None), user: User = Depends(INTAKE)):
    """Add a statement or an answer (typed or spoken). Spoken turns are transcribed immediately."""
    s = _load(session_id, user)
    if s.status != "active":
        raise HTTPException(409, f"This interview is already {s.status}.")
    if len(s.turns) >= MAX_TURNS:
        raise HTTPException(400, f"An interview can have at most {MAX_TURNS} turns.")
    text = (text or "").strip() or None
    audio = audio if audio and audio.filename else None
    if not text and not audio:
        raise HTTPException(400, "Provide text or audio.")
    if text and len(text) > 4000:
        raise HTTPException(400, "A single turn can be at most 4,000 characters.")
    q = None
    if question:
        try:
            q = Question.model_validate(json.loads(question))
        except Exception:
            raise HTTPException(400, "Invalid question.")
        known = s.shown.get(q.key)
        q = known or q.model_copy(update={"text_en": q.text_en[:300],
                                          "text_local": (q.text_local or "")[:300] or None})
    turn = Turn(kind="answer" if q else "statement", question=q)
    if audio:
        ext, data = _read(audio, AUDIO, 24 << 20, "audio")
        folder = _dir(session_id)
        folder.mkdir(parents=True, exist_ok=True)
        turn.stored_name, turn.filename, turn.modality = turn.turn_id + ext, Path(audio.filename).name[:120], "voice"
        (folder / turn.stored_name).write_bytes(data)
        tmp = Source(source_id=turn.turn_id, kind="audio")
        hint = (s.language_hint or "").strip().lower()
        hint = hint if re.fullmatch(r"[a-z]{2,3}", hint) else None
        t0 = time.time()
        try:
            transcribe.run(tmp, folder / turn.stored_name, hint)
            turn.text, turn.segments, turn.language, turn.confidence = tmp.text, tmp.segments, tmp.language, tmp.confidence
            turn.warnings = tmp.warnings
        except Exception as e:
            turn.warnings = [f"Live transcription failed ({type(e).__name__}); it will be retried after submission."]
        turn.stt_ms = int((time.time() - t0) * 1000)
    else:
        turn.text = text

    def fn(x: InterviewSession, c):
        x.turns.append(turn)
        if q and q.key in x.skipped:
            x.skipped.remove(q.key)
        if q:
            x.shown.setdefault(q.key, q)
        audit.append(c, user.username, user.role, "interview_turn_added", None,
                     {"session_id": session_id, "modality": turn.modality, "answers_question": bool(q),
                      "question_origin": q.origin if q else None, "transcribed": bool(turn.text)})
    s = _mutate(session_id, user, fn)
    payload = service.instant(s)[0]
    return {**_with_suggestions(s, payload), "turn": view(s)["turns"][-1]}


@router.delete("/{session_id}/turns/{turn_id}")
def remove_turn(session_id: str, turn_id: str, user: User = Depends(INTAKE)):
    removed = []

    def fn(x: InterviewSession, c):
        keep = [t for t in x.turns if t.turn_id != turn_id]
        if len(keep) == len(x.turns):
            raise HTTPException(404, "Turn not found")
        removed.extend(t for t in x.turns if t.turn_id == turn_id)
        x.turns = keep
        audit.append(c, user.username, user.role, "interview_turn_removed", None, {"session_id": session_id})
    s = _mutate(session_id, user, fn)
    for t in removed:
        if t.stored_name:
            (_dir(session_id) / t.stored_name).unlink(missing_ok=True)
    return _with_suggestions(s)


@router.post("/{session_id}/skip")
def skip(session_id: str, body: Skip, user: User = Depends(INTAKE)):
    def fn(x: InterviewSession, c):
        if body.key not in x.skipped:
            x.skipped.append(body.key)
        q = x.shown.get(body.key)
        audit.append(c, user.username, user.role, "interview_question_skipped", None,
                     {"session_id": session_id, "question_origin": q.origin if q else None})
    return _with_suggestions(_mutate(session_id, user, fn))


@router.post("/{session_id}/attachments")
def attach(session_id: str, report: UploadFile = File(...), user: User = Depends(INTAKE)):
    s = _load(session_id, user)
    if len(s.attachments) >= 3:
        raise HTTPException(400, "At most three reports per interview.")
    ext, data = _read(report, REPORT, 10 << 20, "report")
    from ..schemas import new_id
    sid = new_id("src")
    folder = _dir(session_id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / (sid + ext)).write_bytes(data)

    def fn(x: InterviewSession, c):
        x.attachments.append({"source_id": sid, "filename": Path(report.filename).name[:120], "stored_name": sid + ext})
        audit.append(c, user.username, user.role, "interview_report_attached", None, {"session_id": session_id})
    return _with_suggestions(_mutate(session_id, user, fn))


@router.post("/{session_id}/submit", status_code=202)
def submit(session_id: str, background: BackgroundTasks, user: User = Depends(INTAKE)):
    s = _load(session_id, user)
    if s.status != "active":
        raise HTTPException(409, f"This interview is already {s.status}.")
    if not any(t.text or t.stored_name for t in s.turns) and not s.attachments:
        raise HTTPException(400, "Add at least one statement, answer or report before submitting.")
    case = service.to_case(s)
    with db.tx() as c:
        cur = db.get_session(c, session_id)
        if cur is None or cur.status != "active":
            raise HTTPException(409, "This interview was already submitted.")
        cur.status, cur.case_id = "submitted", case.case_id
        db.put_session(c, cur)
        db.put_case(c, case)
        answered = sum(1 for r in case.interview if r["status"] == "answered")
        audit.append(c, user.username, user.role, "case_created", case.case_id,
                     {"consent_version": CONSENT_VERSION, "sources": [x.kind for x in case.sources],
                      "via": "interview", "session_id": session_id, "questions_answered": answered,
                      "questions_suggested": len(case.interview)})
    background.add_task(orchestrator.run, case.case_id)
    return intake_view(case)


@router.delete("/{session_id}")
def discard(session_id: str, user: User = Depends(INTAKE)):
    def fn(x: InterviewSession, c):
        x.status, x.turns, x.attachments, x.shown = "discarded", [], [], {}
        audit.append(c, user.username, user.role, "interview_discarded", None, {"session_id": session_id})
    _mutate(session_id, user, fn)
    shutil.rmtree(_dir(session_id), ignore_errors=True)
    return {"session_id": session_id, "status": "discarded"}


@router.websocket("/{session_id}/live")
async def live(ws: WebSocket, session_id: str):
    """Client sends {"type":"draft","seq":n,"text":"..."} as the worker types (debounced) or after a turn
    is added ({"type":"refresh","seq":n}). The server answers immediately with rule questions
    (phase "rules") and then, if still current, with model-enriched questions (phase "model")."""
    token = ws.query_params.get("token", "")
    row = db.session_user(token) if token else None
    if row is None or row["role"] not in ("intake", "admin"):
        await ws.close(code=4401)
        return
    user = User(username=row["username"], role=row["role"])
    try:
        _load(session_id, user)
    except HTTPException:
        await ws.close(code=4404)
        return
    await ws.accept()
    latest = {"seq": 0}
    pending: dict[str, asyncio.Task | None] = {"task": None}

    async def model_phase(seq: int, s: InterviewSession, draft: str, analysis: dict):
        try:
            payload = await asyncio.to_thread(service.with_model, s, draft, analysis)
        except Exception as e:
            payload = {"model": {"status": "error", "error": type(e).__name__}}
        if seq == latest["seq"]:
            await asyncio.to_thread(_mutate, session_id, user, lambda x, c: service.remember(x, payload))
            await ws.send_json({"type": "suggest", "phase": "model", "seq": seq, **payload})

    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "ping":
                await ws.send_json({"type": "pong", "t": msg.get("t")})
                continue
            if kind not in ("draft", "refresh"):
                continue
            seq = int(msg.get("seq") or 0)
            latest["seq"] = max(latest["seq"], seq)
            draft = str(msg.get("text") or "")[:4000]
            s = await asyncio.to_thread(_load, session_id, user)
            if s.status != "active":
                await ws.send_json({"type": "closed", "status": s.status})
                continue
            payload, analysis = service.instant(s, draft)
            await ws.send_json({"type": "suggest", "phase": "rules", "seq": seq, **payload})
            if config.COPILOT_LLM and msg.get("model", True):
                if pending["task"] and not pending["task"].done():
                    pending["task"].cancel()
                pending["task"] = asyncio.create_task(model_phase(seq, s, draft, analysis))
            else:
                await asyncio.to_thread(_mutate, session_id, user, lambda x, c: service.remember(x, payload))
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close(code=1011)
        except Exception:
            pass
    finally:
        if pending["task"] and not pending["task"].done():
            pending["task"].cancel()
