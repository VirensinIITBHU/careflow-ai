> **Historical (v1).** The frontend was rewritten in v2; see the README and docs/architecture.md for the current product.

# CareFlow AI | Milestone 1 Review

## One-minute overview

CareFlow AI is a human-in-the-loop intake and review prototype for multilingual patient narratives. It accepts typed text, voice, and reports, then organizes information into evidence-linked details and possible warning signs. A reviewer—not the AI—checks the source and decides what to do with the case.

**The problem:** important details can be difficult to review when they arrive in long notes, voice recordings, mixed Hindi-English speech, or report files. Reviewers need a faster way to locate relevant evidence while keeping the original source visible.

**The approach:** use speech transcription, report reading, structured extraction, and simple safety rules to prepare a review aid. Preserve source links and uncertainty; keep a human responsible for every decision.

> **Synthetic data only. Not for clinical use. The rules are not clinically validated. CareFlow AI does not diagnose, treat, or decide.**

## Milestone 1 walkthrough

1. **Intake:** sign in as intake1, record consent, and submit synthetic text/audio/report input.
2. **Processing:** show the pipeline stages and note that audio transcription and report OCR can run concurrently.
3. **Review queue:** switch among To review, In review, Approved, Consulted, Archived, Rejected, and Processing. Priority is a review aid, not a care decision.
4. **Evidence:** open a case and trace an extracted detail or flag to its source quote, audio time, or report page.
5. **Human review:** resolve flags with reasons, edit the separate human note, and approve or reject.
6. **Follow-up tracking:** from Approved, optionally add a consultation note and mark the case Consulted. Archive a reviewed case and restore it from Archived.

Keep the demo synthetic. Firefox microphone capture is currently unreliable: it worked once and later produced silent audio. Skip the live mic step unless repeated recordings play back clearly before the presentation. Prepare typed input or a separately verified synthetic audio upload as a fallback.

## What has been checked

### Automated tests with mocked model responses

- Consent gate, user roles, intake ownership, session expiry, and logout.
- Pipeline failure handling for text, audio transcription, and OCR paths.
- Evidence offsets and audio timestamps.
- Safety rules for English, Hindi, Hinglish, and Urdu test cases.
- Review, release, rejection, referral, annotation, and priority constraints.
- Privacy-safe intake responses and audit read/hash-chain behavior.

### Live checks reported before the model switch

- Text extraction in English, Hindi, and Hinglish.
- Voice transcription.
- Frontend TypeScript/production build (build check only, not browser workflow verification).

The checked-in model defaults have since changed to Qwen SLMs. Those new defaults have not yet been live-verified; run the model evaluation and a full synthetic workflow with the final configuration before presenting their results.

### Not verified live in the current checklist

- Report-image vision OCR and PDFs.
- Other Indian languages beyond the stated tested scope.
- Optional second-reader behavior and machine-translation quality.
- Full browser workflows, including current microphone-recording behavior.

Do not describe automated synthetic tests as clinical validation. Language status is informational and does not guarantee accuracy for an individual case. Whisper may garble words or label Hindi as Urdu; verify transcripts against the original audio.

## Demo configuration

The checked-in environment template routes extraction, translation, OCR, and the optional second reader through Hugging Face Inference Providers. It uses Qwen3 4B for extraction/translation and the second reader, Qwen3-VL 4B for OCR, and Groq-hosted open-weight Whisper large v3 for speech. Never show or share backend/.env or API keys during the presentation.

The configured extraction primary is now a 4B SLM. Run `python eval/run_slm_eval.py` with provider credentials before reporting benchmark results. The script checks a small synthetic set for source-grounded evidence, symptom status, and negation handling; it is not a clinical accuracy measure. Do not report a score until the run has completed on the final configuration.

## Suggested closing

“CareFlow AI does not replace clinical judgment. It gives a reviewer a structured, evidence-linked starting point, keeps uncertainty visible, and records a human decision. Our next work is to verify the remaining OCR, translation, second-reader, and browser paths, then improve robustness before final submission.”

## Review-day checklist

- Start backend and frontend; sign in with the demo accounts before presenting.
- Use only synthetic cases and make sure no real keys or personal data appear onscreen.
- Test live model calls and record extraction/OCR results on the synthetic model evaluation set ahead of time; prepare a fallback demo in case a provider or free-tier model is unavailable.
- Avoid relying on Firefox microphone recording in the presentation; use it only if the preview is repeatedly audible. Keep typed input or a verified synthetic audio upload ready as backup.
- Keep the “not clinically validated / not for clinical use” boundary explicit.
- Present verification gaps as next steps rather than implying those paths passed.

