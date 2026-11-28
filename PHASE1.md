# VoiceCare — Phase 1 (done)

Phase 2 is intentionally not started; it waits for your confirmation.

## What was built

1. **Quick-Info Card** — name, age, gender, blood group, allergies, emergency contact.
   Saved on the phone (`voicecare_quick_info`), copied onto every summary, the summary
   screen, the PDF and the doctor link. Screen: **My info** (bottom nav) / **Quick-Info Card** tile.
2. **AI follow-up questions** — `POST /api/follow-up` asks Gemini what is missing and returns
   max 3 questions. Each one is skippable, answered by typing or with the in-app mic. Model
   answers are ignored by design: only the patient's own text is sent with the summary.
   If Gemini is unreachable, three generic rule-based questions are used instead.
3. **Original vs summary toggle** — "AI summary" / "My exact words" on the summary screen,
   plus the unedited description and follow-up answers in the PDF.
4. **Urgency flag** — Gemini proposes `urgent_flags`; `filterUrgentFlags()` keeps a flag only
   when the phrase (or all its meaningful words) literally appears in the patient's text.
   Shown in a red banner with the line **"If this is an emergency, call 108."** No severity,
   no diagnosis.
5. **Doctor-language output** — the eight sections are written in the patient's own language
   and script, plus `englishSummary` in English. Screen shows both; the PDF prints both
   columns side by side (native script is rendered via canvas, because jsPDF cannot draw
   Devanagari/Kannada).
6. **QR share** — `POST /api/share` creates a 144-bit token, valid 24 h. `GET /s/:token` is a
   script-free, read-only page (patient info, urgency words, both languages, original words,
   disclaimer) that opens in any phone browser with no login. QR is drawn in-app and also
   printed in the PDF.

Removed: the whole Medicine Reminder feature (screen, nav tab, form, notifications,
cloud reminder sync, storage helpers). `js/notifications.js` is deleted.

## Run it (beginner steps)

1. Open the folder in VS Code / Antigravity: `C:\Users\TECRA X40\Desktop\Hackos project`.
2. Terminal → `cd backend` → `npm.cmd install` (once) → `node server.js`.
3. Browser → `http://127.0.0.1:3000`.
4. Phone build: `cd frontend` → `npx cap sync android` →
   `cd android` → `set JAVA_HOME=%LOCALAPPDATA%\VoiceCareTools\jdk21` → `gradlew.bat assembleDebug`.

`backend/.env` must contain `GEMINI_API_KEY=...`. Never commit it.

## Test checklist

| # | Feature | Steps | Expected |
|---|---|---|---|
| 1 | Quick-Info | My info → fill all six fields → Save | Toast confirms; Home tile shows "Name · age · Blood group …" |
| 2 | Quick-Info on summary | Make any summary | Blue strip with the same line above the summary |
| 3 | Follow-up questions | Speak page → "I have fever." → Generate | Screen "A few quick questions", max 3, each with Speak/Skip |
| 4 | Skip answers | Same screen → Skip all questions | Summary is created, "My exact words" shows no answers |
| 5 | Answers used | Answer one question → Create my summary | Answers appear under "My exact words" and in the PDF |
| 6 | Original toggle | Summary → "My exact words" | Unedited description, nothing rewritten |
| 7 | Urgency flag | Describe "chest pain" → Generate | Red banner lists "chest pain" + "If this is an emergency, call 108." |
| 8 | No invented flags | Describe "fever for 2 days" | Banner stays hidden |
| 9 | Dual language | Set language हिन्दी, describe in Hindi | Left column Hindi, right column English |
| 10 | PDF | Share PDF → Download PDF | Two columns, patient info box, urgent box, original words |
| 11 | QR | Share PDF screen | QR + 24-hour link appear within ~2 s |
| 12 | Doctor page | Scan QR / open link on another device | Read-only page, no login, no app; unknown token → 404 |
| 13 | Expiry | Wait 24 h (or edit `expiresAt` in `backend/.data/shares.json`) | Page says link expired (410) |
| 14 | Reminders gone | Bottom nav / Home | No Medicines tab, no reminder tile |

Automated: `cd backend && npm.cmd test` → 7 passing.

## One thing you must do before the phone uses this

The APK still points at `https://voice-care-t4gz.onrender.com`, which runs the **old**
backend. Push this code (or let Antigravity deploy it) and redeploy on Render, otherwise:

- follow-up questions silently fall back to "no questions",
- the QR button says **"API endpoint not found."**

Locally everything is verified working against `http://127.0.0.1:3000`.
