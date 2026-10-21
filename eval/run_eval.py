"""Offline evaluation of the rule-based safety screen (no API keys, no network).
Usage (from repo root):  python eval/run_eval.py
Reports recall on current warning signs, false alarms on benign text, and context handling."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.safety.engine import outcome  # noqa: E402


def passed(expect: str, got: set[str]) -> bool:
    if expect == "none":
        return not got
    kind, cat = expect.split(":")
    return expect in got and (kind == "context" and f"current:{cat}" not in got or kind == "current")


def main() -> int:
    cases = json.loads((ROOT / "eval" / "cases" / "safety_cases.json").read_text(encoding="utf-8"))
    rows = [(c, outcome(c["text"])) for c in cases]
    groups = {"current": [], "context": [], "none": []}
    by_language: dict[str, list[bool]] = {}
    by_expectation: dict[str, list[bool]] = {}
    for c, got in rows:
        ok = passed(c["expect"], got)
        groups[c["expect"].split(":")[0]].append(ok)
        by_language.setdefault(c["lang"], []).append(ok)
        by_expectation.setdefault(c["expect"], []).append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {c['id']:<26} expected {c['expect']:<40} got {sorted(got) or '-'}")
    print()
    print(f"Cases: {len(cases)}")
    for name, label in (("current", "Red-flag recall (current warning signs found)"),
                        ("context", "Negated/past mentions kept out of 'current'"),
                        ("none", "Benign text with no flag")):
        r = groups[name]
        print(f"{label}: {sum(r)}/{len(r)}")
    print("Per-language pass counts:")
    for lang, results in sorted(by_language.items()):
        print(f"  {lang}: {sum(results)}/{len(results)}")
    print("Per-expected-label pass counts:")
    for label, results in sorted(by_expectation.items()):
        print(f"  {label}: {sum(results)}/{len(results)}")
    return 0 if all(all(v) for v in groups.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
