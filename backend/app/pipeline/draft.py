"""Draft note built deterministically from structured data (no model call, so it cannot add facts)."""
from ..schemas import Case


def _line(s) -> str:
    bits = [s.status] + [x for x in (s.onset, s.duration, s.course if s.course != "unknown" else None,
                                     s.severity_as_reported) if x]
    return f"- {s.name} ({', '.join(bits)})"


def build(case: Case) -> str:
    cur = [s for s in case.symptoms if not s.negated and s.status in ("current", "uncertain")]
    past = [s for s in case.symptoms if not s.negated and s.status in ("past", "resolved")]
    denied = [s.name for s in case.symptoms if s.negated]
    L = ["DRAFT: AI-generated from the supplied sources. Not reviewed. Not a diagnosis or treatment plan.", ""]
    L += ["Reported symptoms:"] + ([_line(s) for s in cur] or ["- none extracted"])
    if past:
        L += ["", "Past or resolved:"] + [_line(s) for s in past]
    if denied:
        L += ["", "Denied by patient: " + ", ".join(denied)]
    if case.facts:
        L += ["", "Other information:"] + [f"- {f.field}: {f.value}" for f in case.facts]
    open_flags = [f for f in case.flags if not f.resolved]
    if open_flags:
        L += ["", f"Automated flags needing review ({len(open_flags)}):"] + [f"- [{f.tier}] {f.title}" for f in open_flags]
    if case.followups:
        L += ["", "Information to clarify with the patient:"] + [f"- {f.question}" for f in case.followups]
    return "\n".join(L)
