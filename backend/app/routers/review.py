import hashlib
import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import audit, db
from ..auth import User, require
from ..schemas import Annotation, Case, Override, RejectCode, Referral, now
from .cases import full_view

router = APIRouter(prefix="/cases", tags=["review"])
audit_router = APIRouter(prefix="/audit", tags=["audit"])
REVIEWER = require("reviewer", "admin")


class Note(BaseModel):
    text: str = Field(min_length=1, max_length=10000)


class Resolve(BaseModel):
    action: Literal["acknowledged", "dismissed"]
    reason: str = Field(min_length=3, max_length=1000)


class Priority(BaseModel):
    tier: Literal["immediate", "urgent", "undetermined", "standard"]
    reason: str = Field(min_length=3, max_length=1000)


class Reject(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)
    code: RejectCode = "other"


class Approve(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    referral_to: Optional[str] = Field(None, max_length=200)
    referral_urgency: Optional[Literal["routine", "soon", "urgent", "emergency"]] = None
    follow_up_in: Optional[str] = Field(None, max_length=100)


class AnnotationIn(BaseModel):
    target_type: Literal["symptom", "fact", "followup", "draft_note"]
    target_index: int = Field(0, ge=0)
    action: Literal["disputed", "corrected"]
    comment: str = Field(min_length=3, max_length=1000)
    correction: Optional[str] = Field(None, max_length=500)


def _do(case_id: str, fn, allowed: set):
    try:
        return full_view(db.update(case_id, fn, allowed))
    except db.NotFound:
        raise HTTPException(404, "Case not found")
    except db.Conflict as e:
        raise HTTPException(409, str(e))


def _assigned(case: Case, user: User) -> None:
    if case.status == "in_review" and case.reviewer_username != user.username and user.role != "admin":
        raise db.Conflict(f"Case is assigned to {case.reviewer_username}.")


@router.post("/{case_id}/review/start")
def start(case_id: str, user: User = Depends(REVIEWER)):
    def fn(case, c):
        if case.status == "in_review":
            raise db.Conflict(f"Case is already in review by {case.reviewer_username}.")
        case.status, case.reviewer_username = "in_review", user.username
        audit.append(c, user.username, user.role, "review_started", case_id)
    return _do(case_id, fn, {"needs_review", "in_review"})


@router.post("/{case_id}/review/release")
def release(case_id: str, user: User = Depends(REVIEWER)):
    """Return a claimed case to the queue while preserving review work."""
    def fn(case, c):
        _assigned(case, user)
        prev = case.reviewer_username
        case.status, case.reviewer_username = "needs_review", None
        audit.append(c, user.username, user.role, "review_released", case_id, {"previous_reviewer": prev})
    return _do(case_id, fn, {"in_review"})


@router.put("/{case_id}/note")
def save_note(case_id: str, body: Note, user: User = Depends(REVIEWER)):
    """Reviewer edits the human note. The AI draft is never modified; each save is kept as a revision."""
    def fn(case, c):
        _assigned(case, user)
        case.note_revisions.append({"at": now(), "by": user.username, "text": body.text})
        audit.append(c, user.username, user.role, "note_edited", case_id,
                     {"chars": len(body.text), "sha256": hashlib.sha256(body.text.encode()).hexdigest()[:12]})
    return _do(case_id, fn, {"in_review"})


@router.post("/{case_id}/flags/{flag_id}/resolve")
def resolve_flag(case_id: str, flag_id: str, body: Resolve, user: User = Depends(REVIEWER)):
    def fn(case, c):
        _assigned(case, user)
        flag = next((f for f in case.flags if f.flag_id == flag_id), None)
        if flag is None:
            raise db.NotFound(flag_id)
        if flag.resolved:
            raise db.Conflict("Flag is already resolved.")
        flag.resolved = True
        flag.resolution = {"action": body.action, "reason": body.reason, "by": user.username, "at": now()}
        audit.append(c, user.username, user.role, "flag_resolved", case_id,
                     {"flag_id": flag_id, "code": flag.code, "tier": flag.tier, "action": body.action})
    return _do(case_id, fn, {"in_review"})


@router.post("/{case_id}/priority")
def override_priority(case_id: str, body: Priority, user: User = Depends(REVIEWER)):
    def fn(case, c):
        _assigned(case, user)
        before = case.effective_tier
        case.tier_override = Override(tier=body.tier, reason=body.reason, by=user.username, at=now())
        audit.append(c, user.username, user.role, "priority_overridden", case_id,
                     {"from": before, "to": body.tier, "system_tier": case.system_tier})
    return _do(case_id, fn, {"in_review"})


@router.post("/{case_id}/approve")
def approve(case_id: str, body: Approve, user: User = Depends(REVIEWER)):
    def fn(case, c):
        _assigned(case, user)
        problems = []
        if case.extraction_failed:
            problems.append("processing failed, so approval is blocked; read the sources and reject or re-submit")
        open_flags = [f for f in case.flags if not f.resolved]
        if open_flags:
            problems.append(f"{len(open_flags)} flag(s) are unresolved; acknowledge or dismiss each with a reason")
        if problems:
            raise db.Conflict("Cannot approve: " + "; ".join(problems) + ".")
        case.final_note, case.status, case.reviewed_at = body.text, "approved", now()
        if body.referral_to is not None or body.referral_urgency is not None or body.follow_up_in is not None:
            case.referral = Referral(to=body.referral_to, urgency=body.referral_urgency,
                                     follow_up_in=body.follow_up_in, by=user.username, at=now())
        case.note_revisions.append({"at": now(), "by": user.username, "text": body.text})
        audit.append(c, user.username, user.role, "approved", case_id,
                     {"edited_from_ai_draft": body.text.strip() != (case.ai_draft_note or "").strip(),
                      "final_tier": case.effective_tier, "has_referral": case.referral is not None,
                      "referral_urgency": case.referral.urgency if case.referral else None})
    return _do(case_id, fn, {"in_review"})


@router.post("/{case_id}/reject")
def reject(case_id: str, body: Reject, user: User = Depends(REVIEWER)):
    def fn(case, c):
        _assigned(case, user)
        case.reviewer_note, case.reject_code = body.reason, body.code
        case.status, case.reviewer_username = "rejected", user.username
        case.reviewed_at = now()
        audit.append(c, user.username, user.role, "rejected", case_id,
                     {"reason_chars": len(body.reason), "code": body.code})
    return _do(case_id, fn, {"needs_review", "in_review"})


@router.post("/{case_id}/annotations")
def annotate(case_id: str, body: AnnotationIn, user: User = Depends(REVIEWER)):
    def fn(case, c):
        _assigned(case, user)
        pool = {"symptom": case.symptoms, "fact": case.facts, "followup": case.followups,
                "draft_note": [case.ai_draft_note]}
        if body.target_index >= len(pool[body.target_type]) or pool[body.target_type][body.target_index] is None:
            raise db.NotFound("target")
        case.annotations.append(Annotation(**body.model_dump(), by=user.username, at=now()))
        audit.append(c, user.username, user.role, "annotation_added", case_id,
                     {"target_type": body.target_type, "target_index": body.target_index, "action": body.action})
    return _do(case_id, fn, {"in_review"})


@audit_router.get("")
def audit_log(limit: int = 200, case_id: Optional[str] = None, actor: Optional[str] = None,
              user: User = Depends(require("admin"))):
    c = db.connect()
    try:
        where, params = [], []
        if case_id is not None:
            where.append("case_id=?")
            params.append(case_id)
        if actor is not None:
            where.append("actor=?")
            params.append(actor)
        clause = " WHERE " + " AND ".join(where) if where else ""
        params.append(max(0, min(limit, 1000)))
        rows = c.execute("SELECT seq,ts,actor,role,action,case_id,details FROM audit" + clause
                         + " ORDER BY seq DESC LIMIT ?", params).fetchall()
    finally:
        c.close()
    return [{**dict(r), "details": json.loads(r["details"])} for r in rows]


@audit_router.get("/verify")
def audit_verify(user: User = Depends(require("admin"))):
    c = db.connect()
    try:
        return audit.verify(c)
    finally:
        c.close()
