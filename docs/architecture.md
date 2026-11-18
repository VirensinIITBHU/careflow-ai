# Architecture

CareFlow AI separates a live intake interview, automated processing, and human review. Processing produces evidence-linked drafts and possible warning signs; authenticated reviewers make all case decisions.

~~~mermaid
flowchart TD
    A[Intake with recorded consent] --> B[Text + one or more audio files + optional report]
    B --> C[Case record and audit event]
    C --> D[Background processing]
    D --> E[Audio transcription]
    D --> F[Report OCR / PDF text extraction]
    E --> G[Structured extraction and translation]
    F --> G
    G --> H[Deterministic safety rules]
    H --> I[Optional second reader: add flags only]
    I --> J[Integrity checks and follow-up questions]
    J --> K[Evidence-linked AI draft]
    K --> L[Prioritized human review queue]
    L --> M[Reviewer checks sources, resolves flags, edits note]
    M --> N[Approve or reject]
    N --> O[Optional consulted note / reversible archive]
    C -. audited actions .-> P[Hash-chained audit log]
    M -. audited actions .-> P
    O -. audited actions .-> P
~~~

## Live interview copilot (backend/app/copilot, backend/app/routers/intake.py)

- An interview session starts only after consent is recorded. Turns are statements or answers, typed or spoken.
  Spoken turns are transcribed immediately.
- `rules.analyse` runs on every keystroke over the WebSocket (`/intake/sessions/{id}/live`) and typically
  finishes in under a millisecond. It:
  - finds possible warning signs with the same safety engine as the pipeline;
  - asks the policy's clarifying question for each warning sign (`ask:` in the YAML);
  - detects common symptoms in English, Hinglish and Hindi, and whether they were denied;
  - checks which details are missing (onset, severity, course, age, medicines, allergies, long-term conditions);
  - computes a completeness score.
- `model.suggest` runs after a typing pause. A small, fast model proposes up to three more questions. Guardrails
  drop questions that diagnose, name conditions, advise, reassure or mention urgency, and drop duplicates of
  planned questions. Symptoms it reports must quote the conversation exactly.
  - If the model is unavailable, the copilot stays in rules-only mode.
  - An HTTP fallback (`/suggest`) exists for networks that block WebSockets.
- On submission, the session becomes a normal case:
  - Typed turns become one text source. The question each turn answered is stored as `prompts` metadata, never
    as screened text.
  - Voice turns become pre-transcribed audio sources.
  - The full question record (answered, skipped, suggested) is stored on the case as `interview`.

## Processing

- Independent stages run in parallel: transcription with OCR, extraction with the second safety reader, and the
  translations. Interview audio that was already transcribed is not transcribed again.
- Clients receive progress over server-sent events (`/cases/{id}/events`, `/queue/events`) instead of polling.
- Cases interrupted by a restart are resumed on boot. `SEED_DEMO` seeds synthetic cases on an empty database.
- Audio transcription and report reading are scheduled concurrently; each audio file becomes its own source and receives its own transcription stage.
- PDF text is extracted from its text layer; report images use the configured vision model and fallback.
- Structured extraction requires evidence quotes to match source text. Unsupported items are dropped and flagged.
- Deterministic warning rules run on readable original source text, independently of extraction. An optional second reader can add flags but cannot remove rule-generated flags.
- Translation is a reading aid. Original text remains authoritative for evidence and screening.
- Follow-up questions identify missing details for a reviewer to verify; they are not clinical recommendations.
- The AI draft note uses a deterministic template rather than free-form model prose.

## Review lifecycle

~~~text
processing -> needs_review -> in_review -> approved | rejected
                                  |
                                  +-- claim / release
approved -> consulted (separate follow-up marker; the case remains approved)
approved or rejected -> archived -> restored to its prior section
~~~

Consulted and archived are tracking fields, not replacements for the clinical review outcome. The optional consultation note is separate from the AI draft and reviewer-approved note. Archiving does not erase the case. Withdrawal is a separate action that erases case content and files while retaining an audit tombstone.

## Data and safety properties

- **Evidence links:** symptoms, facts, and flags refer to source offsets and, where available, audio times or report pages.
- **Fail closed:** extraction failure or unresolved flags block approval. A case with no readable text remains undetermined for human review.
- **Tier visibility:** reviewer overrides do not replace the system tier; “Standard” does not mean safe.
- **Note separation:** the AI draft, reviewer note revisions/final note, and consultation note are separate fields.
- **Roles:** intake sees only its own operational status; reviewers work cases; admins also inspect audit history.
- **Auditing:** case reads, source downloads, review decisions, consultation, archive, and restore are logged. The audit log is hash-chained.
- **Demo sessions:** bearer sessions expire after the configured TTL (8 hours by default) and support logout. This is not production authentication.
- **Providers:**
  - Groq serves extraction, the copilot model, the second reader and Whisper speech-to-text.
  - OpenRouter serves report-image OCR.
  - Hugging Face and local Ollama are still supported.
  - Keys stay server-side.
  - `LLM_CACHE` can record and replay identical provider calls for reliable demos.

## Main components

- backend/app/routers/: authentication, intake, queue, and review routes.
- backend/app/pipeline/: transcription, OCR, extraction, safety, integrity, translation, follow-ups, and draft generation.
- backend/app/safety/ and backend/policy/: deterministic rule screening and policy data.
- backend/app/db.py: SQLite persistence of case JSON, sessions, and audit events.
- backend/app/copilot/: live interview question engine (rules, model, merge, session-to-case).
- backend/app/routers/insights.py: SSE streams, `/metrics`, `/eval/rules`.
- frontend/src/: React + Tailwind app.
  - pages/intake: live interview and copilot hooks.
  - pages/case: evidence-linked brief and source pane.
  - Queue, Ops, Trust and AuditLog pages.

