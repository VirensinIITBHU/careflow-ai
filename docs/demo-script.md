# 3-minute demo script

Synthetic data only. Open the deployed app a minute early so the free-tier server is awake. The demo cases are
seeded automatically.

## 0:00 · The problem (20 s)

"Clinic intake happens in Hindi, Hinglish and English, often by voice, under time pressure, with no guidance on what
to ask. Clinicians get long notes with the important details missing."

## 0:20 · Live interview (70 s): the hero moment

1. Sign in as **Intake**. Tick consent and click **Start interview**.
2. Type slowly, without pressing Enter: `Mujhe kal se bukhar hai aur saans lene mein dikkat`
   - Point at the right rail: **questions update while you type** (the header shows the WebSocket round trip, about 5 ms).
   - The red **Possible warning sign** banner appears. The first question comes from the clinician-editable policy, in Hinglish with English underneath.
   - About half a second later, **AI suggestions** merge in. The status line shows when one was blocked by guardrails.
3. Press Enter. Click **Type answer** on the warning-sign question and answer `Haan, baithe hue bhi`.
4. Show the **Live brief** ring filling and the symptom chips.
5. Optional: click **Record** for a voice answer. It is transcribed live (needs a provider key and a working mic).
6. Click **Send for review**. Stage-by-stage progress streams in live.

## 1:30 · Reviewer (60 s)

1. Sign in as **Reviewer**. The new case is already in the queue (it updates live), ranked Immediate.
2. Open the seeded **DEMO-0042** interview case:
   - Hover a symptom row: the exact words light up in the source. Questions appear inline above the answers they produced.
   - Click **Why?** next to the tier: the matched rule, the matched words, and the statement that models can only add flags.
   - Open the **Interview** tab: answered, skipped and not-asked questions, each labelled by origin (policy, rules or AI).
3. **Start review**, then **Note & decision**: the blockers list shows that unresolved flags block approval. Resolve one with a reason.

## 2:30 · Trust (30 s)

- Open **Trust & safety** and click **Run benchmark**: 116 synthetic cases across 4 languages in milliseconds.
- As admin, click **Verify chain**: the audit log is tamper-evident.
- Close with: "The AI organizes, asks and flags. People decide. Every claim has a receipt."

## Fallbacks

- **No provider keys or rate-limited:** the copilot runs in rules-only mode (still instant). Seeded cases still show the full review experience.
- **Microphone silent:** the recorder detects it and says so. Type instead.
