# CareFlow AI frontend

React, TypeScript, and Vite frontend for the synthetic-data CareFlow AI prototype.

> **Not for clinical use.** The app does not diagnose, treat, or make care decisions. Warning rules are not clinically validated.

## Start the app

1. Start the backend using the instructions in the [root README](../README.md).
2. In a second terminal:

   ~~~bash
   cd frontend
   npm install
   npm run dev
   ~~~

3. Open http://localhost:5173 and sign in with a demo account.

The API defaults to http://127.0.0.1:8000. Set VITE_API_BASE_URL to connect to another backend. The backend’s default CORS configuration includes the Vite development origin.

## Demo accounts

Default password: careflow-demo (unless changed with DEMO_PASSWORD).

- intake1: consent and case intake, own processing status, eligible withdrawal.
- reviewer1 and reviewer2: case review.
- admin1: reviewer access plus audit tools.

These are demo accounts, not identity verification.

## Current screens

- **Intake:** required consent, typed text, audio upload and browser microphone recording, multiple audio sources per case, report upload, optional language hint, and processing status.
- **Review queue:** prioritized open cases, status tabs, filters for the loaded list, and approved/consulted/archived follow-up tracking.
- **Case workspace:** original source view, extracted details and evidence, warning/quality flags, AI draft, human note, follow-up questions, review actions, and audit timeline.
- **Audit:** admin event search and hash-chain verification.

Approved cases can carry an optional consultation note before they are marked consulted. The note is separate from the AI draft and approved human note. Archiving is reversible; restoration returns a case to its prior Approved or Rejected queue section.

## Build

~~~bash
npm run build
~~~

This runs the TypeScript check and creates a production build in dist/.

## Verification limits

The production build has been checked. Browser workflows and live provider-backed flows are not all verified end to end. Microphone capture is currently unreliable in Firefox: it worked once and later produced silent audio. Do not present it as working until repeated recordings have audible previews; use a verified synthetic upload or typed input as a fallback. OCR/PDF paths, second-reader behavior, and translation quality are also not confirmed live. The reviewer queue filters the loaded list only; it does not use server-side filtering or pagination.

