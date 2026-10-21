"""Flags for things we must not guess about: suspicious instructions, conflicts, unclear inputs."""
import re

from .. import config
from ..schemas import Flag, Source, Symptom, locate

_INJECTION = [re.compile(p, re.I) for p in (
    r"ignore (all |any |the )?(previous |above |prior |earlier )?(instructions|rules|prompts?)",
    r"disregard (the |all |any )?(previous |above |prior )?(instructions|rules)",
    r"\b(mark|label|tag)\b.{0,30}\b(low|routine|standard|safe|non-?urgent|normal)\b",
    r"\bset (the )?(priority|urgency|triage)\b",
    r"do(n't| not) (flag|escalate|alert)", r"system prompt", r"developer message",
    r"override .{0,20}(priority|safety|policy)", r"you are now (a |an )?(doctor|admin|system)",
    r"निर्देश(ों)? (को )?(अनदेखा|नजरअंदाज)", r"instructions? (ignore|bhool)",
)]


def injection_flags(sources: list[Source]) -> list[Flag]:
    flags = []
    for s in sources:
        for pat in _INJECTION:
            m = pat.search(s.text or "")
            ev = locate(s, m.group(0)) if m else None
            if ev:
                flags.append(Flag(kind="integrity", code="PROMPT_INJECTION_SUSPECTED", origin="integrity",
                                  title="Text contains instructions aimed at the system",
                                  rationale="The statement contains wording that tries to steer the AI or change "
                                            "priority. It was ignored; safety rules ran on the original text.",
                                  evidence=[ev]))
                break
    return flags


def conflict_flags(symptoms: list[Symptom]) -> list[Flag]:
    """Same symptom both affirmed and denied (within one source or across sources)."""
    groups: dict[str, list[Symptom]] = {}
    for s in symptoms:
        groups.setdefault(s.name.strip().lower(), []).append(s)
    flags = []
    for name, items in groups.items():
        if {s.negated for s in items} == {True, False}:
            flags.append(Flag(kind="integrity", code="CONFLICTING_INFORMATION", origin="integrity",
                              title=f"Conflicting statements about: {name}",
                              rationale="The sources both report and deny this symptom. Neither version was chosen.",
                              evidence=[e for s in items for e in s.evidence][:4]))
    return flags


def quality_flags(sources: list[Source], uncertainties: list[str]) -> list[Flag]:
    flags = []
    for s in sources:
        for seg in [g for g in (s.segments or []) if g["conf"] < config.STT_LOW_CONF or g["no_speech"] > 0.6][:3]:
            ev = locate(s, (s.text or "")[seg["c0"]:seg["c1"]])
            if ev:
                flags.append(Flag(kind="quality", code="LOW_CONFIDENCE_TRANSCRIPTION", origin="integrity",
                                  title="Unclear speech in this passage",
                                  rationale=f"Transcription confidence is low ({seg['conf']}). Listen to the audio.",
                                  evidence=[ev]))
        for w in s.warnings:
            if "illegible" in w or "no readable text" in w or "No text could" in w or "No speech" in w:
                flags.append(Flag(kind="quality", code="UNREADABLE_INPUT", origin="integrity",
                                  title="Part of an input could not be read", rationale=w))
    for u in uncertainties[:5]:
        flags.append(Flag(kind="quality", code="MODEL_UNCERTAINTY", origin="integrity",
                          title="Model reported uncertainty", rationale=u))
    return flags
