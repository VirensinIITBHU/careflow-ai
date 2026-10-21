# CareFlow AI - Architecture Diagram Brief for Claude

> **Purpose:** Give Claude an accurate, implementation-based brief for producing a clear architecture diagram of the current CareFlow AI prototype for a mentor review. This brief distinguishes implemented behavior from the model migration roadmap so the presentation does not imply future work is already live.
>
> **Safety boundary:** Synthetic-data hackathon prototype only. Not for clinical use. Rules are not clinically validated. The AI does not diagnose, recommend treatment, or make case decisions.

## 1. What the diagram should communicate

CareFlow AI is a browser-based, human-in-the-loop intake and review prototype. It accepts typed narratives, one or more audio recordings, and optional report files. The backend processes those inputs into source-linked text and structured draft details, screens the original readable sources with deterministic warning rules, and presents possible findings to an authenticated human reviewer. The reviewer checks the evidence, resolves flags, writes or edits the human note, and makes the final review decision.

The visual should make these points immediately clear:

1. The **human reviewer owns all case decisions**. AI output is a review aid.
2. **Original source material remains authoritative.** Translations and model-extracted fields are aids; evidence quotes must match a source.
3. Audio transcription and report processing are **parallel branches** that join before structured extraction.
4. The deterministic rule screen runs against readable source text independently of whether extraction succeeds. Model-based checks can add possible flags, but cannot clear deterministic flags.
5. The currently configured hosted models and the **future open-weight/local-SLM direction** are different states. Show the roadmap as planned/in progress and visually separate it from the running system.

## 2. System at the current stage (as implemented)

### User-facing clients

- **Browser frontend:** React, TypeScript, and Vite.
- **Intake role:** records consent and submits typed text, audio files, and optional report files; can see limited status for its own cases.
- **Reviewer/admin roles:** use the review queue and case detail view to inspect source evidence and processing results. Admin has additional audit access.
- The browser calls the FastAPI backend over HTTP and uses bearer-session authentication. The demo frontend is not a production identity system.

### Backend and persistence

- **API:** FastAPI application. Routes are grouped around authentication, case intake/case access, reviewer workflow, and admin audit operations.
- **Background pipeline:** processing runs for an accepted case, records named stage statuses, and saves progress so the client can poll status.
- **Database:** SQLite stores case documents, demo sessions, and audit events. Case details are persisted as JSON documents, with indexed status/tier columns.
- **Uploaded files:** saved under the configured backend upload directory, separate from the SQLite case JSON.
- **Audit:** key reads and workflow actions are recorded in a hash-chained audit log. This is a prototype audit mechanism, not a claim of production-grade compliance.
- **Configuration/secrets:** provider and model settings come from `backend/.env`; the checked-in `backend/.env.example` is a template. API keys stay on the backend and must never appear in the diagram, document, screenshot, or frontend.

### Intake data types

- Typed narrative text.
- One or more audio files. Each audio source is processed separately and retains its own transcript/timestamps.
- Optional report file:
  - PDFs with a readable text layer are extracted locally, preserving page references.
  - Report images use a remote vision/OCR model and configured fallback.
  - A scanned PDF without a usable text layer is reported as unreadable by the current PDF path; do not depict automatic PDF-to-image OCR as a current capability.
- Consent is required before intake submission. The diagram should show consent as part of the intake boundary.

## 3. Current processing flow

Use this ordering and these distinctions in the diagram:

### A. Intake and source capture

1. Intake user records consent and submits text, audio, and/or a report.
2. Backend creates a case, stores source metadata/files, records an audit event, and marks the case as processing.
3. Each source has an identity so later evidence can point back to the original source.

### B. Parallel media preparation

The backend schedules audio transcription and report processing concurrently, with up to two media jobs running at once:

- **Audio branch:** Groq-hosted Whisper large v3 transcription; stores text, detected language, segment timestamps, and confidence estimates. Low-confidence or likely silent segments are marked for human verification.
- **Report branch:** PDF text-layer extraction is local; image OCR is sent to Hugging Face vision. The image OCR path retries with the configured vision fallback if the primary call fails. Unreadable text/regions produce warnings instead of guessed content.
- **Typed-text branch:** already-readable source text bypasses transcription/OCR.

Join the branches at “Readable source text + source metadata” before structured extraction. If a source fails to process, retain a visible quality warning and continue with any other readable sources.

### C. Structured extraction and language support

- A configured chat model turns the readable sources into structured symptoms, facts, follow-up suggestions, language, and uncertainty notes.
- Each extracted symptom/fact must include an exact quote from a named source. Backend validation locates the quote in the source; items without verifiable evidence are dropped and a quality flag is added.
- Extracted values are intended to be reviewer-facing English. When non-Latin script appears in extracted fields, a translation stage normalizes those fields to English while keeping the original evidence quote intact.
- If the primary extraction model fails, the configured extraction fallback is tried. If both fail, the case remains reviewable, receives an extraction-failure flag, and approval is blocked.
- Follow-up questions are built from missing information plus model suggestions; they are questions for a human reviewer to ask, not medical instructions.
- Source reading copies can be translated into English. They are display-only; raw source text remains authoritative for evidence and safety screening.

### D. Independent safety and integrity layers

Show these as distinct checks rather than one generic “AI safety” box:

1. **Deterministic policy/rule screening:** runs on readable original source text, including transcript/OCR text. It may mark a mention as current or context/uncertain (for example, past, resolved, or negated). “No automated warning found” does not mean safe.
2. **Extracted-symptom cross-check:** can add a warning where structured extraction found a current warning symptom that the literal rule patterns missed. It cannot remove a rule flag.
3. **Optional second safety reader:** when enabled, uses the configured hosted chat model to identify additional current mentions. It can only add flags; it cannot remove flags or make a decision. If unavailable, the system records that limitation.
4. **Integrity/quality checks:** look for suspicious instructions embedded in source text, contradictory symptom statements, low-confidence audio segments, unreadable inputs, and model uncertainty. These checks make uncertainty visible; they do not establish truth.

### E. Draft and human review

- A deterministic template builds the AI draft note from accepted structured fields, flags, and follow-up questions. It is not free-form model prose and is labeled unreviewed.
- Case, sources, stages, findings, and draft are saved. The case moves to the **To review** queue with a system tier derived from open flags.
- A reviewer opens source evidence (text offsets, audio timestamps, and PDF page references where available), resolves each flag with a reason, may override displayed priority with a reason, and edits a separate human note.
- Approval is blocked when extraction failed or flags remain unresolved. A reviewer may approve or reject; optional referral/follow-up fields can be recorded with approval.
- Approved cases can receive an optional consultation note and be marked **Consulted**. Consulted is follow-up tracking, not a different approval decision.
- Reviewed cases can be archived and restored. Archive is reversible; withdrawal is a separate operation that deletes case content/files while keeping an audit tombstone.
- Key workflow events are added to the hash-chained audit log.

## 4. Model configuration represented in this repository

The exact values below reflect the checked-in environment template and code defaults at the time this brief was prepared. A developer’s private `backend/.env` may differ; do not read, quote, or expose API keys. Have the presenter verify the active configuration before claiming these exact model IDs are running in a live demo.

| Capability | Current configured path in the checked-in example | Important limitation |
|---|---|---|
| Structured extraction and translation | Hugging Face-hosted Qwen3 4B Instruct primary; Qwen3 4B Thinking fallback | Both are open-weight models; inference is hosted, not local. Fallback is for extraction/translation calls. |
| Audio transcription | Groq-hosted Whisper large v3 | Whisper is open-weight; the verbose JSON response includes segment timestamps and confidence estimates. |
| Report-image OCR | Hugging Face-hosted Qwen3-VL 4B SLM primary; Qwen3-VL 8B fallback | Both are open-weight models. Fallback is attempted after primary OCR errors. PDF text extraction is a separate local path. |
| Optional second safety reader | Hugging Face-hosted Qwen3 4B Instruct SLM, enabled in the checked-in example | Optional; can add current flags only. It is not the deterministic policy engine. |
| Deterministic rules | Local Python policy engine using `backend/policy/general_v0.yaml` | No model call; policy is explicitly not clinically validated. |
| Draft note | Local deterministic template | No generative-model call. |
| Local model option | OpenAI-compatible local endpoint is supported for extraction by selecting `EXTRACT_PROVIDER=local` | The current local-provider switch does not make Whisper, image OCR, or the second-reader path local. |

**Terminology to use in the diagram:** “Open-weight model served by hosted provider” is not the same as “local model.” The checked-in defaults use open-weight Qwen models served by Hugging Face Inference Providers and Whisper served by Groq. The current code has an OpenAI-compatible local endpoint option for chat-based calls, but it does not provide a fully local, end-to-end model stack.

## 5. Model migration direction (future / in progress, not yet end-to-end)

The mentor-suggested direction is to reduce dependence on hosted APIs by evaluating local open-weight models while preserving safety checks and human review. The current hosted SLM configuration is implemented; local speech and vision remain future work. Show only those local capabilities as a **dashed, future-state lane** beside or below the current system.

Potential staged path to depict:

1. **Current baseline and evaluation:** keep the existing pipeline operational; evaluate models against a fixed synthetic multilingual set covering extraction, onset/duration, negation, resolved/past status, evidence quoting, translation, and failure behavior.
2. **Local extraction pilot:** use the existing OpenAI-compatible local endpoint option with a suitable local SLM (for example, an Ollama-served model) as a configurable extraction/translation candidate. Compare quality and latency with the hosted primary/fallback before switching defaults.
3. **Local speech pilot:** investigate a locally hosted open speech-to-text model/runtime as an alternative to Groq Whisper. This requires implementation and multilingual/audio-quality evaluation; it is not currently a configured fallback.
4. **Local vision/OCR pilot:** investigate local document OCR/vision for images and scanned PDFs. This requires implementation and tests; current image OCR is hosted, and scanned PDF OCR is not implemented by the current PDF text-layer path.
5. **Provider-independent routing and operational checks:** once measured, make local/hosted choices explicit per task, preserve visible fallback status, and track resource needs, latency, quality, and failure rates.
6. **Human-reviewed rollout:** retain source-linked evidence, deterministic rules, fail-visible behavior, and required human decisions throughout each migration. Do not replace these controls with model confidence or a model-generated “safe” decision.

Do not claim that local SLM replacement is complete. Label future nodes “planned / under evaluation.” Do not imply that a model is clinically validated because it is open source, locally hosted, or performs well on the synthetic evaluation set.

## 6. Suggested diagram layout

Create one primary landscape architecture diagram, readable on a presentation slide (16:9). Organize left to right:

1. **People and browser:** Intake staff; Reviewer/Admin; React + TypeScript web app.
2. **API and case services:** FastAPI; demo bearer auth/role checks; consent/intake and case/review routes.
3. **Data and files:** SQLite case/session/audit store; upload directory; hash-chained audit events.
4. **Processing pipeline:**
   - parallel audio transcription and report parsing/OCR lanes;
   - join into source text with evidence identity;
   - extraction + exact quote validation + English display translation;
   - independent deterministic safety rules, extraction cross-check, optional add-only second reader, integrity checks;
   - follow-up generation and deterministic draft.
5. **Human review:** prioritized queue; source verification; flag resolution; human note; approve/reject/referral; consulted/archive/restore.
6. **Future model lane:** dashed border showing candidate local SLM, local speech model, and local vision/OCR, connected to the relevant pipeline functions with “planned / evaluate first.”

Suggested visual semantics:

- Solid arrows = implemented data/control flow.
- Dashed arrows or dashed container = planned/future work.
- Blue/teal = application and deterministic components.
- Purple = hosted model services.
- Amber = warnings, uncertainty, fallback, or reviewer verification.
- Green = human actions/decisions, while still stating they are not automated.
- Database cylinder = SQLite; folder/storage icon = uploaded files.
- Use labels for **original source**, **translated reading copy**, and **evidence-linked extracted fields** to prevent implying that a translation replaces the source.
- Use explicit connectors showing the deterministic rules run on original readable source text, independently of extraction success.

## 7. Diagram content that must not be lost

- Consent precedes intake submission.
- Audio and report processing run concurrently; extraction begins after readable media text is available.
- PDF text-layer parsing is local; image OCR is hosted and has a configured fallback; scanned-PDF OCR is not a current capability.
- Extraction and translation can use the configured model fallback; do not label every stage as having an independent fallback.
- Transcription currently uses hosted Groq Whisper without a local fallback.
- Rules are deterministic, policy-file driven, and not clinically validated.
- Model-based second reader and extraction cross-check can only add flags.
- Model draft note is generated by a deterministic template.
- Human reviewers make final approval/rejection decisions; approval has gates.
- SQLite/filesystem/audit log are separate supporting stores.
- Hosted open-weight model and local model are different deployment modes.
- Future local SLM direction is clearly “planned / under evaluation,” not live.
- Include a small footer: “Synthetic data only | Not for clinical use | No diagnosis or automated care decision.”

## 8. Ready-to-paste prompt for Claude

~~~text
You are creating a mentor-review architecture diagram for CareFlow AI. Use the attached file “CareFlow AI - Architecture Diagram Brief for Claude” as the source of truth. The brief describes the repository’s current implementation and clearly separates live behavior from future model migration work.

DELIVERABLE
Create one polished, presentation-ready architecture diagram in landscape 16:9 format. Provide:
1. A high-resolution PNG suitable for inserting into slides.
2. An editable source version (prefer Mermaid source or SVG; include the source alongside the PNG).
3. A short legend for line styles and colors.

AUDIENCE AND PURPOSE
The audience is a hackathon mentor reviewing the current milestone. The diagram should be understandable in 30 seconds, technically accurate, and suitable for a live presentation. It should show the current Hugging Face hosted open-weight model stack and the planned work toward a fully local SLM deployment.

NON-NEGOTIABLE ACCURACY RULES
- Treat the brief’s “current stage” as implemented and the “migration direction” as future/planned. Visually separate the future lane with a dashed border and label it “Planned / under evaluation.” Never draw future local speech or vision models as already running.
- Show Hugging Face and Groq model calls as hosted services. “Open-weight, hosted” is not the same as “local.”
- Show local OpenAI-compatible inference as currently supported for chat-based extraction/translation only. Do not imply the current local setting also localizes Whisper transcription, OCR, or the second reader.
- Show audio transcription and report processing as parallel tasks that join before extraction.
- Show report PDFs with readable text layers going through local PDF text extraction. Show report images through hosted vision OCR with fallback. Mark scanned-PDF OCR as not implemented in the current path.
- Show deterministic rules screening original readable source text independently of model extraction. Model checks may add flags but cannot remove flags.
- Show the AI draft note as a deterministic template, not free-form model output.
- Show the human reviewer as the only actor who approves or rejects a case. Include the approval gate for failed extraction and unresolved flags.
- Include exact evidence links/source traceability, uncertainty/quality flags, and the “translation is a reading aid; original remains authoritative” distinction.
- Do not include API keys, credentials, real patient data, or claim clinical validation.

LAYOUT
Use a clean left-to-right system flow with clearly grouped containers:
A. People + browser app: Intake staff, Reviewer/Admin, React/TypeScript/Vite.
B. API/services: FastAPI, demo bearer authentication/roles, consent/intake, case and review routes.
C. Persistence: SQLite for case/session/audit records; upload directory for source files; hash-chained audit events.
D. Processing: parallel audio transcription and report reading/OCR; join at source text; structured extraction with quote validation and translation; independent deterministic rule engine; add-only extraction cross-check and optional second reader; integrity/quality checks; follow-up questions; deterministic draft.
E. Human review: prioritized queue, inspect source evidence, resolve flags, write separate human note, approve/reject/referral, then optional Consulted tracking and reversible archive/restore.
F. Future lane: local SLM for extraction/translation, local speech-to-text, local vision/OCR; connect each to its relevant task with dashed arrows and the label “evaluate against synthetic multilingual cases before switching.”

VISUAL STYLE
- Use strong typography, sparse labels, generous whitespace, and a restrained palette suitable for a technical mentor presentation.
- Solid arrows mean implemented flow. Dashed lines mean future/planned.
- Teal/blue for app and deterministic components; purple for hosted model providers; amber for warnings, uncertainty, fallback, and verification; green for human-controlled actions.
- Use simple recognizable icons for people, browser, API, models, file storage, database, and human review.
- Avoid tiny text, crossing connectors, decorative gradients, excessive detail, and generic “AI brain” imagery.
- Make it clear that the pipeline assists review but does not diagnose or decide.

FOOTER
Include this exact safety footer: “Synthetic data only | Not for clinical use | No diagnosis or automated care decision.”

Before finalizing, cross-check every box and connector against the brief. If a capability is not explicitly described as implemented, put it in the dashed future lane or omit it. Return the files and a concise note describing the visual structure.
~~~

## 9. Presenter notes / verification before showing

- Confirm the active private backend environment before naming exact model IDs on a slide; use the checked-in template only as a reference.
- Never show `backend/.env`, API keys, real patient information, or live secrets to Claude or the mentor.
- If the diagram includes model names, add “configured example” or verify them against the active environment first.
- Keep the safety footer visible and do not equate synthetic test success with clinical performance.
- Present local model work as a roadmap unless a local model has actually been configured, run, and evaluated for that capability.
