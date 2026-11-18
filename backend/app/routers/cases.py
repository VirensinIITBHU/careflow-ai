import shutil
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import audit, config, db
from ..auth import User, require
from ..pipeline import orchestrator
from ..schemas import REJECT_MESSAGES, TIER_RANK, Case, Consent, Source, new_id, now

router = APIRouter(prefix="/cases", tags=["cases"])
AUDIO = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac", ".mp4", ".mpeg", ".mpga"}
REPORT = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
CONSENT_VERSION = "demo-consent-v1"


class ConsultationNoteIn(BaseModel):
    note: str = Field(default="", max_length=4000)


def _read(f: UploadFile, allowed: set, limit: int, label: str) -> tuple[str, bytes]:
    ext = Path(f.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(415, f"{label}: unsupported file type '{ext}'. Allowed: {', '.join(sorted(allowed))}")
    data = f.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"{label} is larger than {limit // 1024 // 1024} MB")
    return ext, data


def full_view(case: Case) -> dict:
    c = db.connect()
    try:
        events = audit.for_case(c, case.case_id)
    finally:
        c.close()
    return {**case.model_dump(mode="json"), "audit_events": events}


def view_for(user: User, case: Case) -> dict:
    """Intake staff only see processing status, not clinical content."""
    if user.role in ("reviewer", "admin"):
        return full_view(case)
    return intake_view(case)


def intake_view(case: Case) -> dict:
    """Return only operational status; stage exception notes can echo provider or patient content."""
    result = {"case_id": case.case_id, "status": case.status, "created_at": case.created_at,
              "stages": [{"name": s.name, "status": s.status, "ms": s.ms} for s in case.stages]}
    if case.status == "rejected":
        result["rejection_message"] = REJECT_MESSAGES[case.reject_code or "other"]
    return result


def _own_or_404(user: User, case: Case) -> None:
    """Hide other intake users' case IDs as not found."""
    if user.role == "intake" and case.created_by != user.username:
        raise HTTPException(404, "Case not found")


def _attention(case: Case) -> int:
    return sum(1 for f in case.flags if not f.resolved and f.kind != "safety")


@router.post("", status_code=202)
def create_case(
    background: BackgroundTasks,
    consent: bool = Form(...),
    language_hint: Optional[str] = Form(None),
    patient_ref: Optional[str] = Form(None),
    text: Optional[str] = Form(None),
    audio: list[UploadFile] = File(default=[]),
    report: Optional[UploadFile] = File(None),
    user: User = Depends(require("intake", "admin")),
):
    if not consent:
        raise HTTPException(400, "Patient consent must be recorded before any processing.")
    audio = [f for f in (audio or []) if f and f.filename]
    report = report if report and report.filename else None
    text = (text or "").strip() or None
    if not (text or audio or report):
        raise HTTPException(400, "Provide at least one input: text, audio or a report file.")
    if text and len(text) > 12000:
        raise HTTPException(400, "Text is longer than 12,000 characters.")
    patient_ref = (patient_ref or "").strip() or None
    if patient_ref and not re.fullmatch(r"[A-Za-z0-9._/-]{1,40}", patient_ref):
        raise HTTPException(400, "Patient reference may contain letters, numbers and . _ / - only, up to 40 characters")
    case = Case(created_by=user.username, language_hint=(language_hint or "").strip()[:30] or None,
                patient_ref=patient_ref, consent=Consent(obtained=True, version=CONSENT_VERSION, at=now()))
    folder = config.UPLOAD_DIR / case.case_id
    uploads = []
    if text:
        case.sources.append(Source(source_id=new_id("src"), kind="text", text=text))
    for f in audio:
        ext, data = _read(f, AUDIO, 24 << 20, "audio")
        sid = new_id("src")
        case.sources.append(Source(source_id=sid, kind="audio", filename=Path(f.filename).name[:120],
                                   stored_name=sid + ext))
        uploads.append((sid + ext, data))
    if report:
        ext, data = _read(report, REPORT, 10 << 20, "report")
        sid = new_id("src")
        case.sources.append(Source(source_id=sid, kind="report", filename=Path(report.filename).name[:120],
                                   stored_name=sid + ext))
        uploads.append((sid + ext, data))
    if uploads:
        folder.mkdir(parents=True, exist_ok=True)
        for name, data in uploads:
            (folder / name).write_bytes(data)
    with db.tx() as c:
        db.put_case(c, case)
        audit.append(c, user.username, user.role, "case_created", case.case_id,
                     {"consent_version": CONSENT_VERSION, "sources": [s.kind for s in case.sources]})
    background.add_task(orchestrator.run, case.case_id)
    return view_for(user, case)


@router.get("")
def list_cases(user: User = Depends(require("reviewer", "admin"))):
    """Prioritized queue: open cases first, then by tier, then unresolved uncertainty, then waiting time.
    ponytail: loads all cases and sorts in Python; fine for demo scale, move to indexed columns past ~10k."""
    c = db.connect()
    try:
        rows = c.execute("SELECT doc FROM cases WHERE status != 'withdrawn'").fetchall()
    finally:
        c.close()
    cases = [Case.model_validate_json(r["doc"]) for r in rows]
    cases.sort(key=lambda x: (x.status in ("approved", "rejected"), TIER_RANK[x.effective_tier],
                              -_attention(x), x.created_at))
    return [{
        "case_id": x.case_id, "status": x.status,
        "effective_tier": None if x.status == "processing" else x.effective_tier,
        "system_tier": None if x.status == "processing" else x.system_tier,
        "created_at": x.created_at, "languages": x.detected_languages, "open_flags": x.open_flags,
        "needs_attention": _attention(x), "reviewer": x.reviewer_username,
        "consulted_at": x.consulted_at, "consulted_by": x.consulted_by,
        "consultation_note": x.consultation_note,
        "archived_at": x.archived_at, "archived_by": x.archived_by,
        "patient_ref": x.patient_ref, "source_kinds": [s.kind for s in x.sources],
        "override": x.tier_override.model_dump() if x.tier_override else None,
        "stage": x.stages[-1].name if x.stages else None,
        "top_flags": [f.title for f in sorted((f for f in x.flags if not f.resolved), key=lambda f: TIER_RANK[f.tier])][:3],
        "symptoms": [s.name for s in x.symptoms if not s.negated and s.status in ("current", "uncertain")][:4],
        "warning_signs": [f.title for f in sorted((f for f in x.flags if f.kind == "safety" and not f.resolved),
                                                  key=lambda f: TIER_RANK[f.tier])][:3],
        "via_interview": bool(x.interview),
    } for x in cases]


@router.post("/{case_id}/consulted")
def mark_consulted(case_id: str, body: ConsultationNoteIn = Body(default=ConsultationNoteIn()),
                   user: User = Depends(require("reviewer", "admin"))):
    with db.tx() as c:
        case = db.get_case(c, case_id)
        if case is None or case.status == "withdrawn":
            raise HTTPException(404, "Case not found")
        if case.archived_at:
            raise HTTPException(409, "Restore this case before marking it consulted.")
        if case.status != "approved":
            raise HTTPException(409, "Only approved cases can be marked consulted.")
        if case.consulted_at:
            raise HTTPException(409, "This case is already marked consulted.")
        case.consulted_at, case.consulted_by = now(), user.username
        case.consultation_note = body.note.strip() or None
        case.updated_at = now()
        db.put_case(c, case)
        audit.append(c, user.username, user.role, "case_marked_consulted", case_id,
                     {"has_note": bool(case.consultation_note), "note_chars": len(case.consultation_note or "")})
    return view_for(user, case)


@router.post("/{case_id}/archive")
def archive_case(case_id: str, user: User = Depends(require("reviewer", "admin"))):
    with db.tx() as c:
        case = db.get_case(c, case_id)
        if case is None or case.status == "withdrawn":
            raise HTTPException(404, "Case not found")
        if case.status not in ("approved", "rejected"):
            raise HTTPException(409, "Only reviewed cases can be archived.")
        if case.archived_at:
            raise HTTPException(409, "This case is already archived.")
        case.archived_at, case.archived_by = now(), user.username
        case.updated_at = now()
        db.put_case(c, case)
        audit.append(c, user.username, user.role, "case_archived", case_id)
    return view_for(user, case)


@router.post("/{case_id}/restore")
def restore_case(case_id: str, user: User = Depends(require("reviewer", "admin"))):
    with db.tx() as c:
        case = db.get_case(c, case_id)
        if case is None or case.status == "withdrawn":
            raise HTTPException(404, "Case not found")
        if not case.archived_at:
            raise HTTPException(409, "This case is not archived.")
        case.archived_at = case.archived_by = None
        case.updated_at = now()
        db.put_case(c, case)
        audit.append(c, user.username, user.role, "case_restored", case_id)
    return view_for(user, case)


@router.get("/mine")
def my_cases(user: User = Depends(require("intake", "admin"))):
    c = db.connect()
    try:
        rows = c.execute("SELECT doc FROM cases WHERE status != 'withdrawn'").fetchall()
    finally:
        c.close()
    cases = [Case.model_validate_json(r["doc"]) for r in rows]
    mine = sorted((x for x in cases if x.created_by == user.username), key=lambda x: x.created_at, reverse=True)
    return [intake_view(x) for x in mine]


@router.get("/stats")
def case_stats(user: User = Depends(require("reviewer", "admin"))):
    c = db.connect()
    try:
        rows = c.execute("SELECT doc FROM cases WHERE status != 'withdrawn'").fetchall()
    finally:
        c.close()
    cases = [Case.model_validate_json(r["doc"]) for r in rows]
    open_cases = [x for x in cases if x.status in ("needs_review", "in_review")]
    by_tier = {tier: sum(x.effective_tier == tier for x in open_cases)
               for tier in ("immediate", "urgent", "undetermined", "standard")}
    return {"open_by_tier": by_tier,
            "unclaimed_immediate": sum(x.status == "needs_review" and x.effective_tier == "immediate" for x in cases),
            "processing": sum(x.status == "processing" for x in cases)}


@router.get("/{case_id}")
def get_case(case_id: str, user: User = Depends(require("intake", "reviewer", "admin"))):
    if user.role in ("reviewer", "admin"):
        with db.tx() as c:
            case = db.get_case(c, case_id)
            if case is None or case.status == "withdrawn":
                raise HTTPException(404, "Case not found")
            if not audit.recently(c, user.username, "case_viewed", case_id, 600):
                audit.append(c, user.username, user.role, "case_viewed", case_id)
    else:
        c = db.connect()
        try:
            case = db.get_case(c, case_id)
        finally:
            c.close()
        if case is None or case.status == "withdrawn":
            raise HTTPException(404, "Case not found")
        _own_or_404(user, case)
    return view_for(user, case)


@router.get("/{case_id}/sources/{source_id}/file")
def source_file(case_id: str, source_id: str, user: User = Depends(require("reviewer", "admin"))):
    with db.tx() as c:
        case = db.get_case(c, case_id)
        if case is None or case.status == "withdrawn":
            raise HTTPException(404, "File not found")
        src = next((s for s in case.sources if s.source_id == source_id and s.stored_name), None)
        path = config.UPLOAD_DIR / case_id / src.stored_name if src else None
        if not path or not path.exists():
            raise HTTPException(404, "File not found")
        if not audit.recently(c, user.username, "source_downloaded", case_id, 300):
            audit.append(c, user.username, user.role, "source_downloaded", case_id, {"source_id": source_id})
    return FileResponse(path, filename=src.filename)


@router.delete("/{case_id}")
def withdraw(case_id: str, user: User = Depends(require("intake", "admin"))):
    """Patient withdrawal: clinical content and uploaded files are erased; a tombstone and the audit trail remain."""
    with db.tx() as c:
        case = db.get_case(c, case_id)
        if case is None or case.status == "withdrawn":
            raise HTTPException(404, "Case not found")
        _own_or_404(user, case)
        if user.role == "intake" and case.status in ("approved", "rejected"):
            raise HTTPException(409, "This case has already been reviewed. Ask an administrator to process a withdrawal request.")
        # Patients do not submit directly in this prototype; intake can request/admin can process reviewed-case withdrawal.
        stone = Case(case_id=case.case_id, created_at=case.created_at, status="withdrawn", system_tier="standard",
                     consent=case.consent.model_copy(update={"withdrawn_at": now()}))
        db.put_case(c, stone)
        audit.append(c, user.username, user.role, "case_withdrawn", case_id, {"content_erased": True})
    shutil.rmtree(config.UPLOAD_DIR / case_id, ignore_errors=True)
    return {"case_id": case_id, "status": "withdrawn"}
