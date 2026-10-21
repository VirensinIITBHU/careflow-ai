# CareFlow AI

**Evidence-linked intake and review for multilingual patient narratives.**

CareFlow AI is a hackathon prototype that turns typed text, voice recordings, and report files into a source-linked summary and possible warning-sign flags for a human reviewer. Reviewers inspect original evidence, resolve flags, add a human note, and approve or reject cases.

> **Synthetic data only. Not for clinical use.** CareFlow AI does not diagnose, recommend treatment, or make care decisions. Its warning rules are not clinically validated.

## What the demo does

1. Intake staff record consent and submit text, audio, and/or a report.
2. Audio transcription and report reading run in the background; audio and report processing can run concurrently.
3. Extraction, translation, rule-based screening, integrity checks, and follow-up questions prepare a draft for review.
4. Reviewers trace findings to source text, audio timestamps, or report pages, then make the decision themselves.
5. Approved cases can be marked **Consulted** with an optional consultation note. Reviewed cases can be archived and restored.

The reviewer queue separates work into **To review**, **In review**, **Approved**, **Consulted**, **Archived**, **Rejected**, and **Processing**. Marking a case consulted moves it out of the pending Approved list. Archive is reversible and does not erase the case.

## Safety and privacy boundaries

- The AI never makes the final decision. A human reviewer must approve a case.
- A “Standard” tier means no automated warning sign was found; it does not mean the patient is safe.
- Extraction failure or unresolved flags block approval. Rule-based screening runs independently on readable text.
- Original source content remains primary. Machine translations and extracted details require human verification.
- Intake accounts see their own operational status only. Reviewer and admin accounts can access clinical content.
- The audit log records key actions and is hash-chained. Withdrawal erases case content and uploaded files while retaining an audit tombstone.
- Use synthetic data only. Do not enter names, credentials, API keys, or real patient records.

## Run locally

### Backend

~~~bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
~~~

Put your `GROQ_API_KEY` and `OPENROUTER_API_KEY` in backend/.env (no Hugging Face token is needed). Never commit that file. Then start the API:

~~~bash
uvicorn app.main:app --reload
~~~

The API runs at http://127.0.0.1:8000 and interactive docs are at http://127.0.0.1:8000/docs. The local SQLite database is created at backend/data/careflow.db.

### Frontend

In a second terminal:

~~~bash
cd frontend
npm install
npm run dev
~~~

Open http://localhost:5173. To use a different API address, set VITE_API_BASE_URL; the default is http://127.0.0.1:8000. The backend’s default CORS list allows localhost port 5173.

### Demo accounts

The default demo password is careflow-demo (change it with DEMO_PASSWORD).

| Account | Role | Demo access |
|---|---|---|
| intake1 | Intake | Create cases, view own processing status, withdraw eligible cases |
| reviewer1, reviewer2 | Reviewer | Review queue, evidence, notes, and case decisions |
| admin1 | Admin | Reviewer access plus audit tools |

These accounts demonstrate role-based access; they are not production authentication.

## Models and configuration

Provider, model, timeout, and fallback settings live in backend/.env.example. The checked-in example currently configures:

| Task | Primary | Fallback / behavior |
|---|---|---|
| Extraction, structured translation, second safety reader | Groq `openai/gpt-oss-20b` (reasoning effort low) | Same model; one automatic retry with backoff on 429/5xx |
| Speech transcription | Groq `whisper-large-v3` | Timestamps and confidence scores are retained |
| Report images (OCR) | OpenRouter `nvidia/nemotron-3.5-content-safety:free` | If it returns no transcription (it is a safety classifier), the pipeline retries with `nvidia/nemotron-nano-12b-v2-vl:free` |

Model availability and rate limits depend on your Groq and OpenRouter accounts (OpenRouter free models are rate-limited). These are hosted models, not a fully local deployment; Ollama is still supported via `EXTRACT_PROVIDER=local`. Run the model evaluation and a live workflow before presenting.

## Verification status

**Automated checks with mocked models** cover consent, roles and intake ownership, session expiry/logout, pipeline-failure screening for text/audio/OCR, evidence offsets, audio timestamps, rule screening in English/Hindi/Hinglish/Urdu, review and referral rules, privacy-safe intake responses, and audit events/hash-chain behavior.

The offline rule benchmark contains synthetic current-warning, negated/past-context, and benign near-miss cases. Forty-seven additional regression examples are provided as readable JSON Lines in `samples/regression/safety_regression_cases.jsonl`; the automated safety tests require those examples to remain synchronized with the benchmark. Passing this benchmark checks the listed phrases and rule behavior only. It does not measure clinical accuracy or guarantee detection on other wording.

**Live checks reported before the model switch:** text extraction in English, Hindi, and Hinglish, plus voice transcription. The new Qwen SLM defaults have not been live-verified yet; run the model evaluation and a full synthetic workflow with the final configuration before reporting them as checked.

**Not verified live in the review checklist:** the new Hugging Face text and vision model configuration, report-image vision OCR, PDFs, other Indian languages, the optional second safety reader, machine-translation quality, and end-to-end frontend workflows. The frontend production build passes, but that does not verify browser microphone capture or provider-backed workflows. Microphone capture is a known Firefox reliability issue: it worked once and later produced silent audio. Do not demo it until the audio preview is consistently audible; use a separately verified synthetic upload or typed input as a fallback. Language labels are informational and do not establish accuracy for an individual case. Whisper may label Hindi speech as Urdu or garble words; use a Hindi language hint where appropriate and tune STT_LOW_CONF in the backend environment.

## Run the automated checks

~~~bash
cd backend
python -m unittest discover -s tests -t .
cd ..
python eval/run_eval.py
python eval/run_slm_eval.py  # live model check; needs backend provider credentials
~~~

Both evaluations use synthetic examples and are not clinical validation. The model evaluation checks source-grounded evidence, symptom status, and negation on a small fixed set. Report results only after running it with the final model configuration; do not present either score as evidence of clinical accuracy.

## Project documents

- [Milestone 1 review brief](docs/milestone-1-review.md): presentation narrative, demo sequence, and honest verification status.
- [Architecture](docs/architecture.md): pipeline and workflow.
- [Assumptions and scope](docs/assumptions.md): safety, privacy, and prototype boundaries.
- [Frontend product brief](docs/frontend-brief-for-claude.md): current UI and handoff context.
- [Backend implementation notes](docs/backend-change-instructions.md): current backend behavior and route additions.

## Repository layout

~~~text
backend/   FastAPI API, pipeline, safety rules, and automated tests
frontend/  React + TypeScript + Vite demo
docs/      Architecture, assumptions, handoff brief, and review notes
eval/      Synthetic rule-evaluation cases and runner
samples/   Synthetic demo inputs
~~~

