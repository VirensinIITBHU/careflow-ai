"""Instant, deterministic interview questions (no model call, typically < 20 ms).

Reads everything said so far, finds symptoms and possible warning signs, checks which details are still missing
(onset, severity, course, age, medicines, allergies, long-term conditions) and proposes the next questions.
Warning-sign questions come from the clinician-editable safety policy. Nothing here can lower priority."""
import hashlib
import re

from ..safety import engine
from ..safety.policy_loader import load as load_policy
from ..schemas import Question, Source
from . import lexicon as L

_SENT = re.compile(r"[.!?\n।]+")


def qid(key: str) -> str:
    return "q" + hashlib.sha1(key.encode()).hexdigest()[:10]


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def _question(key, kind, origin, tpl, lang, priority, slot=None, target=None, names=None) -> Question:
    names = names or {}
    en = tpl["en"].format(s=names.get("en", ""))
    local = None if lang == "en" else _cap(tpl[lang].format(s=names.get(lang, names.get("en", ""))))
    reason = tpl.get("reason", "").format(s=names.get("en", ""))
    return Question(id=qid(key), key=key, kind=kind, origin=origin, slot=slot, target=target,
                    text_en=_cap(en), text_local=local, lang=lang, reason=reason, priority=priority)


def _units(text: str, start: int, end: int) -> tuple[str, str]:
    """(clause, sentence) around a match."""
    cuts = list(engine._SPLIT.finditer(text))
    left = max((m.end() for m in cuts if m.end() <= start), default=0)
    right = min((m.start() for m in cuts if m.start() >= end), default=len(text))
    sl = max((m.end() for m in _SENT.finditer(text) if m.end() <= start), default=0)
    sr = min((m.start() for m in _SENT.finditer(text) if m.start() >= end), default=len(text))
    return text[left:right], text[sl:sr]


def analyse(texts: list[str], answered: set[str], skipped: set[str], hint: str | None = None) -> dict:
    full = "\n".join(t for t in texts if t and t.strip()).replace("’", "'")
    low = full.lower()
    lang = L.detect_language(full, hint)
    policy = load_policy()
    cats = {c["id"]: c for c in policy["categories"]}

    # Possible warning signs, using exactly the same rules as the full pipeline.
    flags = engine.screen([Source(source_id="live", kind="text", text=full)]) if full.strip() else []
    red = [f for f in flags if f.kind == "safety"]
    denied_warn = [f for f in flags if f.kind == "safety_context"]
    red_ids = {f.code for f in red}

    # Common symptoms: present (current mention) or denied/past only.
    found: dict[str, dict] = {}
    for sid, rx in L.SYMPTOM_RE.items():
        for m in rx.finditer(low):
            ctx = engine._context(low, m.start(), m.end())
            clause, sentence = _units(low, m.start(), m.end())
            entry = found.setdefault(sid, {"id": sid, "present": False, "quote": full[m.start():m.end()],
                                           "units": []})
            if ctx == "current":
                if not entry["present"]:
                    entry["quote"] = full[m.start():m.end()]
                entry["present"] = True
                others = sum(1 for o, r in L.SYMPTOM_RE.items() if o != sid and r.search(sentence))
                entry["units"].append(clause)
                if not others:
                    entry["units"].append(sentence)

    present = [e for e in found.values() if e["present"]]
    denied = [e for e in found.values() if not e["present"]]

    questions: list[Question] = []
    slots_total = slots_filled = 0
    missing: list[str] = []

    def want(key: str) -> bool:
        return key not in answered and key not in skipped

    for i, f in enumerate(red):
        key = f"redflag:{f.code}"
        slots_total += 1
        if key in answered:
            slots_filled += 1
            continue
        missing.append(f"clarify {L.WARNING_NAMES.get(f.code, {}).get('en', f.code)}")
        ask = cats[f.code].get("ask")
        if ask and want(key):
            tpl = {**ask, "reason": "A possible warning sign was mentioned. Clarify whether it is happening now; "
                                    "a clinician will review this case with priority."}
            questions.append(_question(key, "redflag", "policy", tpl, lang, i, slot="redflag", target=f.code))

    for i, e in enumerate(present[:6]):
        names = {k: L.SYMPTOMS[e["id"]][k] for k in L.LANGS}
        text = " ".join(e["units"])
        for slot, base in (("onset", 10), ("severity", 20), ("course", 35)):
            key = f"{slot}:{e['id']}"
            counted = slot != "course"
            stated = bool(L.SLOT_PATTERNS[slot].search(text))
            if counted:
                slots_total += 1
            if stated or key in answered:
                slots_filled += counted
                continue
            if counted:
                missing.append(f"{slot} of {names['en']}")
            if want(key) and (slot != "course" or i < 2):
                questions.append(_question(key, "gap", "rules", L.T[slot], lang, base + i, slot=slot,
                                           target=e["id"], names=names))

    has_content = bool(present or red or len(low.split()) >= 4)
    if not has_content:
        slots_total += 1
        missing.append("main complaint")
        if want("opener"):
            questions.append(_question("opener", "opener", "rules", L.T["opener"], lang, 0))
    else:
        slots_total += 1
        slots_filled += 1  # the patient has described the problem

    for j, slot in enumerate(L.GENERIC_ORDER):
        key = f"{slot}:patient"
        slots_total += 1
        if L.GENERIC_PATTERNS[slot].search(low) or key in answered:
            slots_filled += 1
            continue
        missing.append(slot)
        if has_content and want(key):
            questions.append(_question(key, "gap", "rules", L.T[slot], lang, 40 + j, slot=slot, target="patient"))

    questions.sort(key=lambda q: q.priority)
    symptoms = [{"id": e["id"], "name": L.SYMPTOMS[e["id"]]["en"], "status": "present", "quote": e["quote"],
                 "warning": False, "origin": "rules"} for e in present]
    symptoms += [{"id": f.code, "name": L.WARNING_NAMES.get(f.code, {}).get("en", f.title), "status": "present",
                  "quote": f.evidence[0].quote if f.evidence else "", "warning": True, "origin": "rules"}
                 for f in red]
    symptoms += [{"id": e["id"], "name": L.SYMPTOMS[e["id"]]["en"], "status": "denied", "quote": e["quote"],
                  "warning": False, "origin": "rules"} for e in denied]
    symptoms += [{"id": f.code, "name": L.WARNING_NAMES.get(f.code, {}).get("en", f.title), "status": "denied",
                  "quote": f.evidence[0].quote if f.evidence else "", "warning": True, "origin": "rules"}
                 for f in denied_warn if f.code not in red_ids]
    return {
        "language": lang,
        "questions": questions,
        "symptoms": symptoms,
        "warning_signs": [{"code": f.code, "title": f.title, "quote": f.evidence[0].quote if f.evidence else ""}
                          for f in red],
        "completeness": {"filled": slots_filled, "total": max(slots_total, 1),
                         "pct": round(100 * slots_filled / max(slots_total, 1)), "missing": missing[:8]},
        "full_text": full,
    }
