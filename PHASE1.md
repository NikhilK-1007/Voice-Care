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
5. **Doctor-facing English only** — the app records the complaint in any language and always
   shows one English summary. AI **possible symptoms** are listed separately as suggestions
   for the doctor to confirm; the patient's exact words stay one tap away for reference.
6. **Share PDF** — the summary is exported as a PDF / plain text through the system share
   sheet. The QR code and the read-only doctor web page were removed on request.

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
| 1 | Patients | Patients → Add patient → fill name/age/blood group → Save information | The saved card replaces the form; Home tile shows the active patient |
| 2 | Multiple patients | Add a second patient → Use | Both records listed; the chosen one is marked Active |
| 3 | Prescription | Edit a patient → Photos / Camera / Document → choose a file → Save | Thumbnail (or PDF chip) stays on the patient card |
| 4 | Possible symptoms | Record "Patient has fever for 2 days" → Generate | Amber panel lists common companion symptoms, marked as AI suggestions |
| 5 | No suggestions | Record a non-medical sentence | The suggestions panel stays hidden |
| 6 | Patient words | Summary → "Patient's words" | The unedited complaint, nothing rewritten |
| 7 | Urgency flag | Record "chest pain" → Generate | Red banner lists "chest pain" + "If this is an emergency, call 108." |
| 8 | No invented flags | Record "fever for 2 days" | Banner stays hidden |
| 9 | English only | Record in Hindi or Kannada | One English summary; no second-language block anywhere |
| 10 | PDF | Share PDF → Download PDF | English sections, patient box, urgent box, AI suggestions in a separate block |
| 11 | No QR | Share PDF screen | No QR panel, no link, no expiry text |
| 12 | Removed share page | Open `/api/share` | 404 — the endpoint and `/s/:token` page no longer exist |
| 13 | Reminders gone | Bottom nav / Home | No Medicines tab, no reminder tile |

Automated: `cd backend && npm.cmd test` → 9 passing.

## One thing you must do before the phone uses this

The APK points at `https://voice-care-t4gz.onrender.com`. Render redeploys from `main`, so
push and let Render redeploy before testing on the phone, otherwise the phone still gets the
older server behaviour (no possible-symptom suggestions, old English handling).

Locally everything is verified working against `http://127.0.0.1:3000`.
