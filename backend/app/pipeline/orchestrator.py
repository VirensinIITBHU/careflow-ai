"""Runs the pipeline for one case in the background and saves after every stage (clients poll progress).
Fails closed: any failure leaves the case in review with an explicit flag and never as 'standard'."""
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from .. import audit, config, db
from ..safety import engine
from ..safety.policy_loader import load as load_policy
from ..schemas import Case, Flag, Stage, compute_tier, now
from . import draft, extract, followups, integrity, ocr, transcribe, translate

# Seeded demo cases: case_id -> {"extraction": {...}, "text_en": {source_index: str}}. Used only by app/demo.py
# so a fresh deployment shows realistic cases without provider keys. Rules, integrity and drafts still run live.
FIXTURES: dict[str, dict] = {}

TESTED_LANGUAGES = {"en", "english", "hi", "hindi", "hinglish", "hindi-english"}


def language_status(lang: str | None) -> str:
    value = (lang or "").strip().lower()
    if not value:
        return "uncertain"
    if value in TESTED_LANGUAGES or value.startswith(("en-", "hi-")):
        return "tested"
    if value in {"ur", "urdu"} or value.startswith("ur-"):
        return "uncertain"  # Whisper can label Hindi speech as Urdu.
    return "untested"


def _save(case: Case) -> None:
    with db.tx() as c:
        row = c.execute("SELECT status FROM cases WHERE case_id=?", (case.case_id,)).fetchone()
        if row is None or row["status"] == "withdrawn":
            raise db.Withdrawn()  # patient withdrew while processing: stop and write nothing
        case.updated_at = now()
        db.put_case(c, case)


def _step(case: Case, name: str, fn):
    st = Stage(name=name, status="running")
    case.stages.append(st)
    _save(case)
    t0, ok, result = time.time(), True, None
    try:
        result = fn()
        st.status = "done"
    except db.Withdrawn:
        raise
    except Exception as e:
        ok, st.status, st.note = False, "failed", f"{type(e).__name__}: {str(e)[:200]}"
    st.ms = int((time.time() - t0) * 1000)
    _save(case)
    return ok, result


def resume_interrupted() -> list[str]:
    """Cases left in 'processing' by a restart (e.g. a redeploy on Render) are processed again from the start."""
    c = db.connect()
    try:
        ids = [r["case_id"] for r in c.execute("SELECT case_id FROM cases WHERE status='processing'")]
    finally:
        c.close()
    return ids


def run(case_id: str) -> None:
    c = db.connect()
    try:
        case = db.get_case(c, case_id)
    finally:
        c.close()
    if case is not None and case.stages and case.status == "processing":
        # A previous run was interrupted: start clean so stages and flags are not duplicated.
        case.stages, case.flags, case.symptoms, case.facts, case.followups = [], [], [], [], []
        case.extraction_failed = False
    if case is None or case.status != "processing":
        return
    try:
        _run(case)
    except db.Withdrawn:
        return
    except Exception as e:  # last resort
        case.extraction_failed = True
        case.flags.append(Flag(kind="quality", code="PIPELINE_ERROR", origin="integrity",
                               title="Processing failed", rationale=f"Unexpected error: {type(e).__name__}. Review the sources manually."))
        _finish(case)


def _finish(case: Case) -> None:
    case.system_tier = compute_tier(case)
    case.processed_at = now()
    case.status = "needs_review"
    with db.tx() as c:
        row = c.execute("SELECT status FROM cases WHERE case_id=?", (case.case_id,)).fetchone()
        if row is None or row["status"] == "withdrawn":
            return
        case.updated_at = now()
        db.put_case(c, case)
        audit.append(c, "pipeline", "ai", "pipeline_completed", case.case_id, {
            "extract_model": config.EXTRACT_MODEL, "extract_fallback_model": config.EXTRACT_FALLBACK_MODEL,
            "extract_used_fallback": any(s.name == "extract_fallback" and s.status == "done" for s in case.stages),
            "stt_model": config.STT_MODEL,
            "policy_version": load_policy()["version"], "second_reader": config.SECOND_READER,
            "system_tier": case.system_tier, "flags": len(case.flags), "failed": case.extraction_failed})


def _process_media(case: Case, hint: str | None) -> None:
    """Transcribe audio and OCR reports concurrently, then merge source changes and statuses once."""
    jobs = []
    for src in case.sources:
        if src.kind not in ("audio", "report") or (src.kind == "audio" and src.pretranscribed and src.text):
            continue
        path = config.UPLOAD_DIR / case.case_id / src.stored_name if src.stored_name else None
        name = "transcribe" if src.kind == "audio" else "ocr"
        stage = Stage(name=name, status="running")
        case.stages.append(stage)
        jobs.append((src, path, name, stage))
    if not jobs:
        return
    _save(case)

    def process(src, path, name):
        started = time.time()
        try:
            if name == "transcribe":
                transcribe.run(src, path, hint)
            else:
                ocr.run(src, path)
            return True, int((time.time() - started) * 1000), None
        except Exception as exc:
            return False, int((time.time() - started) * 1000), f"{type(exc).__name__}: {str(exc)[:200]}"

    with ThreadPoolExecutor(max_workers=min(2, len(jobs))) as pool:
        futures = {pool.submit(process, src, path, name): (src, name, stage)
                   for src, path, name, stage in jobs}
        for future in as_completed(futures):
            src, name, stage = futures[future]
            ok, stage.ms, stage.note = future.result()
            stage.status = "done" if ok else "failed"
            if not ok:
                src.warnings.append(f"{src.kind} processing failed; this input could not be used.")
                case.flags.append(Flag(kind="quality", code="UNREADABLE_INPUT", origin="integrity",
                                       title=f"The {src.kind} input could not be processed",
                                       rationale="Processing failed. Review the original file manually."))
            _save(case)


def _parallel(case: Case, jobs: list[tuple[str, callable]]) -> list[tuple[bool, object]]:
    """Run independent stages concurrently. Worker threads only compute; the case is saved from this thread."""
    if not jobs:
        return []
    stages = [Stage(name=name, status="running") for name, _ in jobs]
    case.stages += stages
    _save(case)
    results: list = [None] * len(jobs)

    def timed(fn):
        t0 = time.time()
        try:
            return True, fn(), int((time.time() - t0) * 1000), None
        except Exception as exc:
            return False, None, int((time.time() - t0) * 1000), f"{type(exc).__name__}: {str(exc)[:200]}"

    with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
        futures = {pool.submit(timed, fn): i for i, (_, fn) in enumerate(jobs)}
        for fut in as_completed(futures):
            i = futures[fut]
            ok, value, stages[i].ms, stages[i].note = fut.result()
            stages[i].status = "done" if ok else "failed"
            results[i] = (ok, value)
            _save(case)
    return results


def _run(case: Case) -> None:
    hint = (case.language_hint or "").strip().lower()
    hint = hint if re.fullmatch(r"[a-z]{2,3}", hint) else None  # Whisper wants an ISO code
    fx = FIXTURES.pop(case.case_id, None)
    _process_media(case, hint)
    texts = [s for s in case.sources if s.text]
    suggestions, uncertainties, lang = [], [], None
    second = None
    if config.SECOND_READER and texts and not fx:
        # Independent of extraction, so it runs alongside it; its flags are de-duplicated after the rules ran.
        second_stage = Stage(name="safety_second_reader", status="running")
        case.stages.append(second_stage)
        _save(case)
        second_pool = ThreadPoolExecutor(max_workers=1)
        second_t0 = time.time()
        second = second_pool.submit(engine.model_second_read, list(case.sources), [])
    if not texts:
        case.extraction_failed = True
        case.stages.append(Stage(name="extract", status="skipped", note="no readable text"))
    else:
        def run_extract(model):
            if fx:
                return extract.parse(case.sources, fx["extraction"])
            return extract.run(case.sources, case.language_hint, model=model)

        ok, res = _step(case, "extract", lambda: run_extract(config.EXTRACT_MODEL))
        if not ok and config.EXTRACT_FALLBACK_MODEL and config.EXTRACT_FALLBACK_MODEL != config.EXTRACT_MODEL:
            ok, res = _step(case, "extract_fallback", lambda: run_extract(config.EXTRACT_FALLBACK_MODEL))
        if ok:
            case.symptoms, case.facts, suggestions, uncertainties, lang, dropped = res
            case.flags += dropped
            if not fx and translate.extracted_fields_need_english(case.symptoms, case.facts, suggestions, uncertainties):
                translated, _ = _step(case, "translate_extracted_fields", lambda: translate.extracted_fields_to_english(
                    case.symptoms, case.facts, suggestions, uncertainties))
                if not translated:
                    case.flags.append(Flag(kind="quality", code="ENGLISH_TRANSLATION_UNAVAILABLE", origin="integrity",
                                           title="Some extracted details may not be in English",
                                           rationale="The extracted details could not be normalized to English. "
                                                     "Check the original source and its English reading copy."))
        else:
            case.extraction_failed = True
            case.flags.append(Flag(kind="quality", code="EXTRACTION_FAILED", origin="integrity",
                                   title="Structured extraction failed",
                                   rationale="No structured summary exists. Read the original sources. Safety rules still ran on the raw text."))
    # Run the independent screen even if extraction failed. Audio and reports are
    # screened after transcription/OCR populated their source text above.
    def _rules():  # keyword rules need no model; the symptom cross-check adds what they missed
        found = engine.screen(case.sources)
        return found + engine.from_symptoms(case.symptoms, found)
    ok, flags = _step(case, "safety_rules", _rules)
    if ok:
        case.flags += flags
    else:
        case.extraction_failed = True
        case.flags.append(Flag(kind="quality", code="SAFETY_SCREEN_FAILED", origin="integrity",
                               title="Safety screen failed", rationale="Review all sources manually."))
    if second is not None:
        try:
            extra, ok = second.result(), True
            have = {(f.code, f.evidence[0].source_id) for f in case.flags if f.kind == "safety" and f.evidence}
            extra = [f for f in extra if (f.code, f.evidence[0].source_id) not in have]
            second_stage.status = "done"
        except Exception as e:
            extra, ok = [], False
            second_stage.status, second_stage.note = "failed", f"{type(e).__name__}: {str(e)[:200]}"
        finally:
            second_pool.shutdown(wait=False)
        second_stage.ms = int((time.time() - second_t0) * 1000)
        _save(case)
        if ok:
            case.flags += extra
        else:
            case.flags.append(Flag(kind="quality", code="SECOND_READER_UNAVAILABLE", origin="integrity",
                                   title="Optional second safety reader was unavailable",
                                   rationale="Only the rule-based screen ran."))
    ok, flags = _step(case, "integrity", lambda: integrity.injection_flags(case.sources)
                      + integrity.conflict_flags(case.symptoms) + integrity.quality_flags(case.sources, uncertainties))
    case.flags += flags if ok else []
    case.uncertainties = uncertainties
    for src in case.sources:
        if src.text and not src.language and lang:
            src.language = lang
        src.language_status = language_status(src.language)
    langs = [x.lower() for x in [s.language for s in case.sources] + [lang] if x]
    case.detected_languages = list(dict.fromkeys(langs))
    ok, fus = _step(case, "followups", lambda: followups.build(case, suggestions))
    case.followups = fus or []
    jobs = []
    for src in case.sources:
        language = (src.language or "").strip().lower()
        if src.text and language and language not in ("en", "english") and not language.startswith("en-"):
            def _source_translation(source=src):
                # text_en is display-only; extraction, safety rules, and evidence use source.text.
                if not translate.to_english(source):
                    raise ValueError("translation did not return a usable English copy")
            jobs.append(("translate_source", _source_translation))
    local = next((x for x in case.detected_languages if x not in ("en", "english")), None)
    if local and case.followups:
        jobs.append(("translate_questions", lambda: translate.run(case.followups, local)))
    if fx:
        for i, txt in (fx.get("text_en") or {}).items():
            case.sources[int(i)].text_en = txt
        for fu, local in zip(case.followups, fx.get("questions_local") or []):
            fu.question_local = local
        jobs = []
    _parallel(case, jobs)
    case.ai_draft_note = draft.build(case)
    _finish(case)
