"""Run the small synthetic extraction benchmark against the configured primary model.

Usage from the repository root: python eval/run_slm_eval.py
Requires the backend environment and configured model-provider credentials. This
measures prototype behavior only; it is not a clinical accuracy benchmark.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import config  # noqa: E402
from app.pipeline import extract  # noqa: E402
from app.schemas import Source  # noqa: E402


def evidence_text(src: Source, symptom) -> str:
    if not symptom.evidence:
        return ""
    return symptom.evidence[0].quote


def main() -> int:
    cases = json.loads((ROOT / "eval" / "slm_extraction_cases.json").read_text(encoding="utf-8"))
    totals = {key: 0 for key in ("evidence", "status", "negation")}
    for case in cases:
        src = Source(source_id="eval", kind="text", text=case["text"])
        symptoms, facts, _, _, _, _ = extract.run([src], case["lang"])
        if case["status"] == "none":
            ok = not facts and not symptoms
            print(f"{'PASS' if ok else 'FAIL'} {case['id']}: no unsupported symptom/fact invented")
            continue
        matching = [s for s in symptoms if case["evidence"].casefold() in evidence_text(src, s).casefold()]
        hit = bool(matching)
        status_ok = hit and matching[0].status == case["status"]
        negation_ok = hit and matching[0].negated == case["negated"]
        totals["evidence"] += hit
        totals["status"] += status_ok
        totals["negation"] += negation_ok
        print(f"{'PASS' if hit else 'FAIL'} {case['id']}: evidence {'ok' if hit else 'missing'}; "
              f"status {'ok' if status_ok else 'mismatch'}; negation {'ok' if negation_ok else 'mismatch'}")
    scored = len(cases) - sum(c["status"] == "none" for c in cases)
    print(f"\nConfigured primary: {config.EXTRACT_PROVIDER}/{config.EXTRACT_MODEL}")
    print(f"Evidence grounding: {totals['evidence']}/{scored}")
    print(f"Current/past status: {totals['status']}/{scored}")
    print(f"Negation handling: {totals['negation']}/{scored}")
    return 0 if all(totals[k] == scored for k in totals) else 1


if __name__ == "__main__":
    sys.exit(main())
