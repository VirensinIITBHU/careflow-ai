"""Follow-up questions: per-symptom gaps (one combined question each), then model suggestions,
then generic intake gaps. De-duplicated and capped so no single source crowds out the others."""
from ..schemas import Case, FollowUp


def build(case: Case, suggestions: list[tuple[str, str]]) -> list[FollowUp]:
    gaps: list[FollowUp] = []
    for s in case.symptoms:
        if s.negated or s.status not in ("current", "uncertain"):
            continue
        no_onset, no_sev = not s.onset, not s.severity_as_reported
        if no_onset and no_sev:
            gaps.append(FollowUp(question=f"When did the {s.name} start, and how severe is it?",
                                 reason="Onset and severity are not stated."))
        elif no_onset:
            gaps.append(FollowUp(question=f"When did the {s.name} start?", reason="Onset is not stated."))
        elif no_sev:
            gaps.append(FollowUp(question=f"How severe is the {s.name}?", reason="Severity is not stated."))
    fields = " ".join(f.field.lower() for f in case.facts)
    generic = [FollowUp(question=q, reason=f"No {label} information was provided.")
               for key, label, q in (("age", "age", "What is the patient's age?"),
                                     ("medic", "medication", "Is the patient taking any medicines?"),
                                     ("allerg", "allergy", "Does the patient have any known allergies?"))
               if key not in fields]
    ordered = gaps[:3] + [FollowUp(question=q, reason=r) for q, r in suggestions][:3] + generic
    seen, final = set(), []
    for fu in ordered + gaps[3:]:
        k = fu.question.lower().strip("? ")
        if k not in seen:
            seen.add(k)
            final.append(fu)
    return final[:8]
