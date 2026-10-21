# Architecture

CareFlow AI separates intake, automated processing, and human review. Processing produces evidence-linked drafts and possible warning signs; authenticated reviewers make all case decisions.

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

## Processing

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
- **Providers:** Hugging Face Inference Providers serves the configured open-weight text, vision, and speech models; the token stays server-side. Text/vision use the OpenAI-compatible chat route, while speech uses Hugging Face's ASR task route.

## Main components

- backend/app/routers/: authentication, intake, queue, and review routes.
- backend/app/pipeline/: transcription, OCR, extraction, safety, integrity, translation, follow-ups, and draft generation.
- backend/app/safety/ and backend/policy/: deterministic rule screening and policy data.
- backend/app/db.py: SQLite persistence of case JSON, sessions, and audit events.
- frontend/src/: React app and typed API client.

