"""Live interview copilot: merges instant rule questions with fast-model questions and turns a finished
interview into a normal case for the existing pipeline."""
import shutil
import time

from .. import config
from ..schemas import Case, InterviewSession, Question, Source, new_id
from . import model, rules

MAX_QUESTIONS = 5


def _texts(session: InterviewSession, draft: str | None) -> list[str]:
    return [t.text for t in session.turns if t.text] + ([draft] if draft and draft.strip() else [])


def _answered(session: InterviewSession) -> set[str]:
    keys = {t.question.key for t in session.turns if t.kind == "answer" and t.question}
    if any(t.kind == "statement" and t.text for t in session.turns):
        keys.add("opener")
    return keys


def conversation(session: InterviewSession) -> list[dict]:
    out = []
    for t in session.turns:
        if not t.text:
            continue
        out.append({"q": t.question.text_en, "a": t.text} if t.kind == "answer" and t.question else {"said": t.text})
    return out


def _payload(analysis: dict, questions: list[Question], model_info: dict, t0: float) -> dict:
    return {
        "questions": [q.model_dump() for q in questions[:MAX_QUESTIONS]],
        "symptoms": analysis["symptoms"],
        "warning_signs": analysis["warning_signs"],
        "completeness": analysis["completeness"],
        "language": analysis["language"],
        "model": model_info,
        "ms": int((time.time() - t0) * 1000),
    }


def instant(session: InterviewSession, draft: str | None = None) -> tuple[dict, dict]:
    """Rule-only suggestions. Returns (client payload, analysis for a later model merge)."""
    t0 = time.time()
    a = rules.analyse(_texts(session, draft), _answered(session), set(session.skipped), session.language_hint)
    info = {"status": "pending" if config.COPILOT_LLM else "off", "ms": 0}
    return _payload(a, a["questions"], info, t0), a


def with_model(session: InterviewSession, draft: str | None = None, analysis: dict | None = None) -> dict:
    t0 = time.time()
    a = analysis or rules.analyse(_texts(session, draft), _answered(session), set(session.skipped),
                                  session.language_hint)
    asked = [t.question.text_en for t in session.turns if t.question]
    skipped_text = [q.text_en for k, q in session.shown.items() if k in session.skipped]
    planned = [q.text_en for q in a["questions"]] + asked + skipped_text
    m = model.suggest(conversation(session), draft or "", a["language"], planned, a["full_text"])
    qs = list(a["questions"])
    skipped = set(session.skipped)
    qs += [q for q in m["questions"] if q.key not in skipped]
    qs.sort(key=lambda q: q.priority)
    # Model-only symptoms (other wording or languages) are added as chips; rule findings stay as they are.
    names = {s["name"] for s in a["symptoms"]}
    a = {**a, "symptoms": a["symptoms"] + [s for s in m["symptoms"] if s["name"] not in names]}
    return _payload(a, qs, {k: v for k, v in m.items() if k not in ("questions", "symptoms")}, t0)


def remember(session: InterviewSession, payload: dict) -> None:
    """Keep every suggested question so the reviewer can see what was suggested, answered and skipped."""
    for q in payload.get("questions", []):
        session.shown.setdefault(q["key"], Question(**q))


def to_case(session: InterviewSession) -> Case:
    """Typed turns become one text source (with question context as metadata); each voice turn becomes an
    audio source that is already transcribed; report attachments become report sources."""
    case = Case(created_by=session.created_by, language_hint=session.language_hint, patient_ref=session.patient_ref,
                consent=session.consent, interview_session_id=session.session_id)
    src_dir, dst_dir = config.UPLOAD_DIR / "sessions" / session.session_id, config.UPLOAD_DIR / case.case_id
    typed = Source(source_id=new_id("src"), kind="text", label="Typed during interview", text="", prompts=[])
    record: list[dict] = []
    for t in session.turns:
        if t.modality == "typed" and t.text:
            sep = "\n\n" if typed.text else ""
            c0 = len(typed.text) + len(sep)
            typed.text += sep + t.text
            if t.question:
                typed.prompts.append({"c0": c0, "c1": c0 + len(t.text), "question": t.question.text_en})
                record.append({"question": t.question.model_dump(), "status": "answered",
                               "source_id": typed.source_id, "start": c0, "end": c0 + len(t.text)})
        elif t.modality == "voice" and t.stored_name:
            sid = new_id("src")
            ext = "." + t.stored_name.rsplit(".", 1)[-1]
            dst_dir.mkdir(parents=True, exist_ok=True)
            if (src_dir / t.stored_name).exists():
                shutil.copy2(src_dir / t.stored_name, dst_dir / (sid + ext))
            label = f"Answer to: {t.question.text_en}" if t.question else "Spoken statement"
            src = Source(source_id=sid, kind="audio", filename=t.filename or f"{t.turn_id}{ext}",
                         stored_name=sid + ext, text=t.text, segments=t.segments if t.text else None,
                         language=t.language, confidence=t.confidence, warnings=list(t.warnings), label=label,
                         pretranscribed=bool(t.text),
                         prompts=[{"c0": 0, "c1": len(t.text or ""), "question": t.question.text_en}]
                         if t.question else None)
            case.sources.append(src)
            if t.question:
                record.append({"question": t.question.model_dump(), "status": "answered", "source_id": sid,
                               "start": 0, "end": len(t.text or "")})
    if typed.text:
        typed.prompts = typed.prompts or None
        case.sources.insert(0, typed)
    for a in session.attachments:
        ext = "." + a["stored_name"].rsplit(".", 1)[-1]
        sid = new_id("src")
        dst_dir.mkdir(parents=True, exist_ok=True)
        if (src_dir / a["stored_name"]).exists():
            shutil.copy2(src_dir / a["stored_name"], dst_dir / (sid + ext))
        case.sources.append(Source(source_id=sid, kind="report", filename=a["filename"], stored_name=sid + ext))
    answered = {r["question"]["key"] for r in record}
    for key, q in session.shown.items():
        if key in answered:
            continue
        record.append({"question": q.model_dump(), "status": "skipped" if key in session.skipped else "suggested",
                       "source_id": None, "start": None, "end": None})
    case.interview = record
    return case
