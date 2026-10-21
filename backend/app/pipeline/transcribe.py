"""Voice -> text with timestamps and provider confidence when available."""
import math
from pathlib import Path

from .. import config, llm
from ..schemas import Source


def run(src: Source, path: Path, language_hint: str | None) -> None:
    data = llm.transcribe(path, config.STT_MODEL, language_hint)
    parts, segs, pos = [], [], 0
    confidence_unavailable = bool(data.get("confidence_unavailable"))
    for s in data.get("segments") or []:
        txt = (s.get("text") or "").strip()
        if not txt:
            continue
        conf = 0.55 if confidence_unavailable or s.get("confidence_unavailable") else max(
            0.0, min(1.0, math.exp(s.get("avg_logprob", -1.0))))
        segs.append({"start": s.get("start", 0), "end": s.get("end", 0), "c0": pos, "c1": pos + len(txt),
                     "conf": round(conf, 2), "no_speech": round(s.get("no_speech_prob", 0.0), 2)})
        parts.append(txt)
        pos += len(txt) + 1  # segments are joined by one space
    if not parts and data.get("text"):
        parts = [data["text"].strip()]
    src.text, src.segments = " ".join(parts) or None, segs
    src.language = data.get("language")
    if data.get("language_hint_ignored"):
        src.warnings.append("The Hugging Face ASR route auto-detects language and did not apply the supplied language hint.")
    if segs and not confidence_unavailable:
        src.confidence = round(sum(s["conf"] for s in segs) / len(segs), 2)
        low = [s for s in segs if s["conf"] < config.STT_LOW_CONF or s["no_speech"] > 0.6]
        if low:
            src.warnings.append(f"{len(low)} of {len(segs)} audio segments have low transcription confidence.")
    elif confidence_unavailable:
        src.warnings.append("The transcription provider does not return confidence scores; listen to the original audio to verify it.")
    if not src.text:
        src.warnings.append("No speech could be transcribed.")
