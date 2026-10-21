# Assumptions and scope

## Intended users

- **Intake staff** record consent and submit a patient narrative or report.
- **Reviewers** inspect original material and evidence, resolve flags, write a human note, and decide whether to approve or reject.
- **Admins** have reviewer access and can inspect the audit log.
- Patients do not use the prototype directly.

## Product goal

Clinics receive symptom descriptions as typed notes, voice recordings, and reports, including Hindi and Hindi-English mixes. This prototype aims to organize those inputs and make possible warning signs easier for a human reviewer to inspect. It does not replace clinical judgment or make a diagnosis.

## Safety boundaries

- Synthetic data only; not for clinical use.
- The AI does not diagnose, treat, prescribe, or make the final decision.
- The deterministic rules in backend/policy/general_v0.yaml cover general categories such as breathing difficulty, chest pain, fainting, stroke-like signs, heavy bleeding, seizure, self-harm, confusion, blood in vomit/stool/urine, severe pain, poisoning/overdose, possible severe allergic reaction, and head injury.
- The rules and paraphrases are a draft and are not clinically validated. They can miss unusual wording, misspellings, and context; additions for poisoning/overdose, allergic reaction, head injury, and Hindi/Hinglish spellings need clinician review.
- A second model reader can add possible flags; it cannot remove flags.
- “Standard” means no automated warning sign was found. It does not mean safe. “Undetermined” means the system could not assess the case reliably.
- Negation, past symptoms, unclear audio, illegible reports, conflicting statements, and suspicious instructions require human verification.

## Data handling and privacy

- Consent is recorded before processing.
- Intake accounts see only their own operational case status and do not receive clinical content.
- patient_ref is an optional restricted-format reference visible to reviewers/admins. It may still identify someone when linked to outside data; never enter names.
- The AI draft, approved human note, and consultation note are stored separately.
- Marking a case consulted records the reviewer and time, with an optional consultation note for future reference.
- Archiving a reviewed case is reversible and does not erase it. Restoring it returns it to the corresponding Approved or Rejected section.
- Withdrawal is different from archive: withdrawal erases case content and uploaded files, while retaining a tombstone and audit trail.
- The audit log is hash-chained and does not store patient text, patient references, or free-text notes in event details.
- Demo sessions expire after eight hours by default. Authentication is not production-grade.

## Language scope

English, Hindi, and Hindi-English are the tested language scope for extraction/transcription as reported in the current review checklist. Automated rule tests also include Urdu. Other Indian languages are untested. Per-source language status is informational, not an accuracy guarantee. Machine translations must be checked against the original text.

## Known limitations

- Rule screening is not a validated clinical instrument.
- The offline synthetic regression benchmark exercises current warnings, negated or historical mentions, and benign near-misses. It is a software regression check, not a clinical performance estimate.
- Model extraction can omit or misstate information; evidence quotes help reviewers check the source.
- Whisper may garble speech or label Hindi as Urdu. A language hint may improve transcription but cannot guarantee it; reviewers must verify transcripts against the audio.
- Live report-image OCR, PDF behavior, optional second-reader behavior, translation quality, and all browser workflows are not fully verified.
- Browser microphone recording has a known Firefox reliability issue: it worked once and later produced silent audio. Do not rely on this path in a live demo until repeated preview playback is confirmed. Multiple audio-source intake also needs an end-to-end browser/API check.
- Real EHR integration, production authentication, clinical validation, guaranteed handwriting OCR, and real-time streaming audio are out of scope.

