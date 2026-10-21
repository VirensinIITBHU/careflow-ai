"""Data contracts. A Case is stored as one JSON document; tier/status are also indexed columns."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, computed_field


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


Tier = Literal["immediate", "urgent", "undetermined", "standard"]
# "undetermined" sorts above "standard": a case we could not assess is never ranked as routine.
TIER_RANK = {"immediate": 0, "urgent": 1, "undetermined": 2, "standard": 3}
Status = Literal["processing", "needs_review", "in_review", "approved", "rejected", "withdrawn"]
RejectCode = Literal["unclear_audio", "illegible_report", "insufficient_information", "needs_redescription", "other"]
REJECT_MESSAGES = {
    "unclear_audio": "The voice recording could not be understood. Please re-record or describe the symptoms again.",
    "illegible_report": "The report could not be read. Please provide a clearer copy.",
    "insufficient_information": "More information is needed. Please ask the patient to describe the problem again.",
    "needs_redescription": "Please ask the patient to describe the problem again.",
    "other": "This submission could not be used. Please speak to the reviewing clinician.",
}


class Referral(BaseModel):
    to: Optional[str] = None
    urgency: Optional[Literal["routine", "soon", "urgent", "emergency"]] = None
    follow_up_in: Optional[str] = None
    by: str
    at: str


class Annotation(BaseModel):
    annotation_id: str = Field(default_factory=lambda: new_id("an"))
    target_type: Literal["symptom", "fact", "followup", "draft_note"]
    target_index: int = 0
    action: Literal["disputed", "corrected"]
    comment: str
    correction: Optional[str] = None
    by: str
    at: str


class Span(BaseModel):
    """Evidence: exact character range in a source's text (+ audio time / page when known)."""
    source_id: str
    start: int
    end: int
    quote: str
    page: Optional[int] = None
    t_start_ms: Optional[int] = None
    t_end_ms: Optional[int] = None


class Source(BaseModel):
    source_id: str
    kind: Literal["text", "audio", "report"]
    filename: Optional[str] = None
    stored_name: Optional[str] = None
    language: Optional[str] = None
    language_status: Optional[Literal["tested", "untested", "uncertain"]] = None
    text: Optional[str] = None
    text_en: Optional[str] = None
    confidence: Optional[float] = None
    segments: Optional[list[dict]] = None   # audio: {start,end,c0,c1,conf,no_speech}
    pages: Optional[list[list[int]]] = None  # report PDF: [page, start, end]
    warnings: list[str] = Field(default_factory=list)


class Symptom(BaseModel):
    name: str
    status: Literal["current", "past", "resolved", "uncertain"] = "uncertain"
    negated: bool = False
    onset: Optional[str] = None
    duration: Optional[str] = None
    course: Literal["worsening", "improving", "stable", "unknown"] = "unknown"
    severity_as_reported: Optional[str] = None
    evidence: list[Span] = Field(default_factory=list)
    needs_verification: bool = False


class Fact(BaseModel):
    field: str
    value: str
    evidence: list[Span] = Field(default_factory=list)


class Flag(BaseModel):
    flag_id: str = Field(default_factory=lambda: new_id("fl"))
    kind: Literal["safety", "safety_context", "integrity", "quality"]
    code: str
    tier: Literal["immediate", "urgent", "standard"] = "standard"
    title: str
    rationale: str
    evidence: list[Span] = Field(default_factory=list)
    origin: Literal["rule", "model", "integrity"] = "rule"
    policy_version: Optional[str] = None
    resolved: bool = False
    resolution: Optional[dict] = None


class FollowUp(BaseModel):
    question: str
    reason: str
    question_local: Optional[str] = None  # machine translation into the patient's language


class Stage(BaseModel):
    name: str
    status: Literal["running", "done", "failed", "skipped"]
    ms: int = 0
    note: Optional[str] = None


class Consent(BaseModel):
    obtained: bool
    version: str
    at: str
    withdrawn_at: Optional[str] = None


class Override(BaseModel):
    tier: Literal["immediate", "urgent", "undetermined", "standard"]
    reason: str
    by: str
    at: str


class Case(BaseModel):
    case_id: str = Field(default_factory=lambda: f"CF-{uuid4().hex[:10].upper()}")
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    created_by: str = ""
    patient_ref: Optional[str] = None
    status: Status = "processing"
    consent: Consent
    language_hint: Optional[str] = None
    detected_languages: list[str] = Field(default_factory=list)

    sources: list[Source] = Field(default_factory=list)
    symptoms: list[Symptom] = Field(default_factory=list)
    facts: list[Fact] = Field(default_factory=list)
    flags: list[Flag] = Field(default_factory=list)
    followups: list[FollowUp] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    stages: list[Stage] = Field(default_factory=list)
    extraction_failed: bool = False

    system_tier: Tier = "undetermined"
    tier_override: Optional[Override] = None

    ai_draft_note: Optional[str] = None      # never edited; the human note is a separate field
    note_revisions: list[dict] = Field(default_factory=list)  # {at, by, text}
    final_note: Optional[str] = None
    reviewer_username: Optional[str] = None
    reviewer_note: Optional[str] = None      # rejection reason
    reject_code: Optional[RejectCode] = None
    consulted_at: Optional[str] = None
    consulted_by: Optional[str] = None
    consultation_note: Optional[str] = None
    archived_at: Optional[str] = None
    archived_by: Optional[str] = None
    referral: Optional[Referral] = None
    annotations: list[Annotation] = Field(default_factory=list)
    reviewed_at: Optional[str] = None

    @computed_field
    @property
    def effective_tier(self) -> str:
        return self.tier_override.tier if self.tier_override else self.system_tier

    @computed_field
    @property
    def open_flags(self) -> int:
        return sum(1 for f in self.flags if not f.resolved)


def locate(src: Source, quote: str) -> Optional[Span]:
    """Find `quote` in the source text and return a span with offsets, audio time and page."""
    text, q = src.text or "", (quote or "").strip()
    if not q:
        return None
    i = text.find(q)
    if i < 0:
        i = text.lower().find(q.lower())
    if i < 0:
        return None
    j = i + len(q)
    span = Span(source_id=src.source_id, start=i, end=j, quote=text[i:j])
    hit = [s for s in (src.segments or []) if s["c0"] < j and s["c1"] > i]
    if hit:
        span.t_start_ms = int(min(s["start"] for s in hit) * 1000)
        span.t_end_ms = int(max(s["end"] for s in hit) * 1000)
    for page, a, b in src.pages or []:
        if a <= i < b:
            span.page = page
    return span


def compute_tier(case: Case) -> str:
    """Highest tier among safety flags; a case we could not assess is 'undetermined', never 'standard'."""
    tiers = [f.tier for f in case.flags if f.kind == "safety"]
    best = min(tiers, key=lambda t: TIER_RANK[t], default="standard")
    if best == "standard" and (case.extraction_failed or not any(s.text for s in case.sources)):
        return "undetermined"
    return best
