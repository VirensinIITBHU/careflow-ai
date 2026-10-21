# Backend implementation notes

This file replaces the original coding-agent implementation prompt with a concise record of the current backend contract. The source code is authoritative if a detail here becomes outdated.

## Current responsibilities

- FastAPI routes handle demo login, role checks, consented intake, case status, reviewer actions, and admin audit tools.
- SQLite stores each case as a JSON document. New case fields have defaults so existing case rows continue to load without a schema migration.
- Background processing transcribes each attached audio source and reads reports, then extracts structured details, applies independent rule screening, and prepares reviewer-facing outputs.
- Reviewers inspect evidence and make the final approve/reject decision. Extraction failure or unresolved flags block approval.

## Current intake and queue additions

- POST /cases accepts consent, text, repeated audio files, one report, language_hint, and patient_ref. Every audio file becomes a separate source; each has the normal 24 MB per-file limit.
- GET /cases returns queue fields including priority, top flags, symptoms, language, assignment, consultation state, and archive state.
- POST /cases/{id}/consulted marks an approved case consulted. It accepts an optional JSON body with a note. The note is capped at 4,000 characters and stored separately from reviewer notes and the AI draft.
- POST /cases/{id}/archive archives an approved or rejected case without changing its review outcome or deleting data.
- POST /cases/{id}/restore clears the archive marker and returns the case to its prior Approved, Consulted, or Rejected section.
- Consultation, archive, and restore actions append audit events. Audit details include note presence/length, not note content.

## Safety and privacy invariants

- Intake responses contain operational status only, for cases owned by that intake account. Reviewer free text and clinical data are not exposed to intake.
- The AI cannot lower a tier or make the final decision. The optional second reader can add flags only.
- Audit details must not contain patient text, patient references, or free-text notes.
- Withdrawal erases case content and uploaded files while retaining a tombstone and audit history. Archive is reversible and does not erase data.
- API keys belong only in the untracked backend/.env; use backend/.env.example for names/defaults and never publish actual secrets.

## Verification record

The current review checklist reports automated backend checks using mocked models for consent, roles, sessions, pipeline failure handling, evidence offsets, audio timestamps, safety rules, review constraints, privacy-safe responses, and audit integrity. Live checks reported by the developer cover text extraction in English/Hindi/Hinglish and voice transcription.

Live OCR/PDF, other Indian languages, second-reader behavior, translation quality, and full browser workflows remain unverified in that checklist. Run the repository’s current checks before making new verification claims; do not reuse historical test counts from the earlier implementation plan.

