> **Historical (v1).** The frontend was rewritten in v2; see the README and docs/architecture.md for the current product.

# Frontend product brief and current implementation

Use this document to orient future UI work. The current app is a React + TypeScript + Vite frontend in frontend/; it is already implemented. Keep the API and safety boundaries below in view when changing it.

## Product

CareFlow AI is a hackathon prototype for consented intake and human review of typed narratives, voice recordings, and reports. It creates evidence-linked summaries and possible warning-sign flags; a human reviewer makes all decisions.

**Synthetic data only. Not for clinical use.** The app does not diagnose or treat. Rules are not clinically validated, and “Standard” never means “safe.”

## Roles and screens

- **Intake:** consent, text, one or more audio files, browser microphone recording, report upload, optional language hint, and own case processing status. Never render clinical details to intake users.
- **Reviewer:** prioritized queue and case workspace with original sources, extracted symptoms/facts, evidence, flags, follow-up questions, AI draft, editable human note, approval/rejection, and audit timeline.
- **Queue follow-up:** Approved lists cases awaiting consultation. A reviewer may add an optional consultation note (up to 4,000 characters) and mark a case Consulted. Archiving is available for reviewed cases; Archived offers Restore.
- **Admin:** reviewer workflow plus audit event list and chain verification.

## API additions used by the queue

- GET /cases includes consulted_at, consulted_by, consultation_note, archived_at, and archived_by.
- POST /cases/{id}/consulted accepts a JSON note and records the reviewer/time.
- POST /cases/{id}/archive archives approved/rejected cases; POST /cases/{id}/restore restores them.
- POST /cases accepts repeated audio form fields. Browser-recorded audio is submitted through the same upload pipeline as uploaded audio.

See backend/app/routers/cases.py and backend/app/schemas.py for the live contract.

## UI and safety rules

- Keep original text primary and label translations as machine-generated reading aids.
- Keep AI draft, approved human note, and consultation note distinct.
- Show system tier separately from reviewer override. Present a Standard result as “no automated warning sign found,” never as safe.
- Explain why approval is blocked when flags remain unresolved or extraction failed.
- Require reasons for flag resolution and priority override. Do not let model/source text lower urgency.
- Intake can see only its own safe operational status; treat filenames, source text, and API messages as untrusted text.
- Keep visible synthetic-data / not-for-clinical-use messaging.

## Current verification limits

The frontend production build has been checked, but that is not end-to-end browser verification. Microphone capture has been tried in Firefox and is currently unreliable: it worked once and later produced silent audio. OCR/PDF behavior, second-reader behavior, translation quality, and full browser workflows also remain unverified live. Validate paths in the target environment before claiming them in a demo.

