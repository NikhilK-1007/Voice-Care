<div align="center">
  <img src="frontend/www/assets/logo.png" alt="VoiceCare Logo" width="96" height="96" />
  <h1>🩺 VoiceCare</h1>
  <p><strong>AI-Powered Voice-First Healthcare Communication Assistant for Indian Patients</strong></p>
  <p><em>"Speak naturally. Let AI organise. Help your doctor understand."</em></p>

  ![Platform](https://img.shields.io/badge/Platform-Android%20(Capacitor)%20%7C%20Web-0F766E)
  ![Backend](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-14B8A6)
  ![AI](https://img.shields.io/badge/AI-Google%20Gemini-0D9488)
  ![Auth & DB](https://img.shields.io/badge/Auth%20%26%20DB-Supabase%20PostgreSQL-0F766E)
</div>

---

## ✨ Why VoiceCare?

In busy Indian clinics, patients—especially elderly individuals and those uncomfortable typing—often struggle to explain symptoms clearly within a short consultation.

**VoiceCare** lets patients speak or type naturally in **Kannada, Hindi, English, or any other Indian language**, then uses **Google Gemini AI** to organise their words into a clean, **8-section doctor-friendly English summary**—without diagnosing, prescribing, or inventing missing information.

---

## 🧭 Architecture Overview

```mermaid
flowchart LR
    A["📱 Android App (Capacitor)\nHTML · CSS · JS · MediaRecorder"] -->|HTTPS Audio / Text| B["⚙️ Express Backend (Render)\nSafety Validator · Model Chain"]
    B -->|REST API (Key on Server)| C["🧠 Google Gemini AI\nTranscribe + 8-Section JSON"]
    A -->|Email / Google OAuth + RLS| D["🗄️ Supabase\nAuth & PostgreSQL Sync"]
    A -->|Offline| E["📄 jsPDF + Native Share\nDoctor-Ready PDF"]
```

---

## 🚀 Key Features

| Category | What VoiceCare Delivers |
| --- | --- |
| 🎙️ **In-App Voice Input** | Built-in `MediaRecorder` (`32 kbps` mono Opus, up to 60s) posts to `/api/transcribe`—no external keyboard install required. |
| 🌐 **Multilingual Support** | UI in **English, हिन्दी (Hindi), ಕನ್ನಡ (Kannada)** + automatic AI detection of any Indian spoken language or transliteration (Hinglish, Kanglish, Tamil, Telugu, Bengali, Marathi, etc.). |
| 📋 **8-Section Doctor Summary** | Organises text into: *Main Concern, Symptoms, Duration, Severity, Medical History, Current Medications, Observations, Questions to Ask the Doctor*. |
| 🛡️ **Strict Healthcare Safety** | Never diagnoses or prescribes. Unmentioned fields stay `"Not mentioned by patient"`. Red-flag symptoms surface **108 / 112** emergency guidance. |
| ✏️ **Edit & Confirm Gate** | Patients review and edit every section individually and confirm accuracy before sharing. |
| 📄 **Offline PDF & Sharing** | Client-side `jsPDF` report generation, Android native Share sheet (`@capacitor/share`), and one-tap clipboard copy. |
| 💊 **Medicine Reminders** | Prescription-based local reminder scheduling via `@capacitor/local-notifications`. |
| 🔐 **Guest Mode + Supabase** | Instant zero-setup Guest Mode (on-device `localStorage`) or optional Email / Google Sign-In with PostgreSQL Row-Level Security. |
| ♿ **Elderly Accessibility** | Large & Extra-Large text scaling, High Contrast mode, Calm Display (reduced motion), and clear step-by-step navigation across 12 screens. |

---

## 📲 Patient Workflow

1. **Welcome & Mode** — Start instantly in **Guest Mode** or sign in with **Email / Google**.
2. **Choose Language** — Pick **English, हिन्दी, ಕನ್ನಡ**, or another language.
3. **Speak or Type** — Tap the microphone button inside the app to record symptoms (or type/edit manually).
4. **AI Organisation** — VoiceCare structures your description into 8 doctor-ready sections in simple English.
5. **Review, Edit & Confirm** — Fix any detail, add missing context, and confirm before sharing.
6. **Download or Share PDF** — Export a clean consultation PDF or share directly with your doctor.

---

## 📁 Project Folder Structure

```text
Voice-Care/
├── backend/
│   ├── package.json              # Express, CORS, Helmet, dotenv, rate-limit
│   ├── .env.example              # Environment variable template (copy to .env)
│   ├── server.js                 # Express server, middleware & static frontend hosting
│   ├── routes/
│   │   ├── summary.js            # POST /api/summarize & /api/regenerate
│   │   └── transcribe.js         # POST /api/transcribe (base64 audio -> text)
│   ├── services/
│   │   ├── geminiService.js      # Gemini model chain, low-latency STT & demo fallback
│   │   └── safetyValidator.js    # 8-section schema & multilingual 108/112 checks
│   └── tests/
│       └── api.test.js           # Node built-in test suite (5/5 passing)
├── frontend/
│   ├── package.json              # Capacitor 6 Android + plugins + jsPDF
│   ├── capacitor.config.json     # Capacitor config (appId: in.voicecare.app)
│   ├── scripts/
│   │   └── copy-vendor.js        # Copies jsPDF to www/vendor/ for offline PDFs
│   ├── android/                  # Native Capacitor Android project
│   └── www/
│       ├── index.html            # 12 mobile screens
│       ├── assets/               # VoiceCare app logo (logo.svg, logo.png)
│       ├── css/styles.css        # Teal & mint elderly-friendly design system
│       └── js/
│           ├── config.js         # Backend API_BASE_URL & Supabase client config
│           ├── i18n.js           # English, Hindi & Kannada UI translations
│           ├── voice.js          # In-app MediaRecorder voice capture
│           ├── api.js            # Fetch wrappers (/api/health, /summarize, /transcribe)
│           ├── supabase.js       # Email + Google OAuth + PostgreSQL cloud sync
│           ├── storage.js        # Local persistence for guest data & settings
│           ├── pdf.js            # Offline jsPDF generation & Capacitor Share
│           ├── notifications.js  # Local medicine reminder alerts
│           └── app.js            # Navigation & screen controllers
├── HANDOFF.md                    # Technical architecture & handoff notes
└── README.md
```

---

## 🛠️ Local Setup & Running

### Prerequisites
- **Node.js v18+** ([nodejs.org](https://nodejs.org/))
- **Google Gemini API Key** ([aistudio.google.com/apikey](https://aistudio.google.com/apikey))

### 1️⃣ Start the Backend
```bash
cd backend
npm install
```
Copy `backend/.env.example` to `backend/.env` and add your Gemini key:
```env
PORT=3000
GEMINI_API_KEY=your_actual_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
ALLOW_DEMO_FALLBACK=true
ALLOWED_ORIGINS=*
```
*(On Windows PowerShell, use `npm.cmd` if `npm.ps1` is blocked by execution policy.)*

Start the server and run tests:
```bash
npm start     # Serves API + web app at http://localhost:3000
npm test      # Runs automated validation & API tests (5 tests)
```

### 2️⃣ Prepare Frontend Assets & Preview in Browser
```bash
cd frontend
npm install
npm run prepare:vendor
```
Open **`http://localhost:3000`** in Chrome/Edge and press `F12` → `Ctrl + Shift + M` to preview in mobile viewport mode.

---

## 🤖 Building the Android APK

| Component | Version |
| --- | --- |
| **JDK** | Temurin 21 (`$LOCALAPPDATA/VoiceCareTools/jdk21`) |
| **Gradle / AGP** | Gradle `8.7` · Android Gradle Plugin `8.2.1` |
| **Android SDK** | `compileSdk` / `targetSdk 34` |

```bash
cd frontend
npm run prepare:vendor
npx cap sync android
cd android
export JAVA_HOME="$LOCALAPPDATA/VoiceCareTools/jdk21"
./gradlew.bat assembleDebug
```
The built APK is generated at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

To install on a USB-connected phone:
```bash
adb install -r path/to/app-debug.apk
```

---

## ☁️ Backend Deployment (Render) & Cloud Auth (Supabase)

- **Backend Hosting:** Configured for **Render** (`Root Directory: backend`, Build: `npm install`, Start: `npm start`, Env Var: `GEMINI_API_KEY`). Set `API_BASE_URL` in `frontend/www/js/config.js` to your HTTPS Render URL before building a production/shipped APK.
- **Database & Auth:** Uses **Supabase** (`public.summaries` table with Row-Level Security `auth.uid() = user_id`), supporting Email/Password login and Google OAuth via the Android deep link `in.voicecare.app://auth-callback`.

---

## 🩺 Healthcare Safety Commitments

- ❌ **Never** diagnoses diseases or medical conditions.
- ❌ **Never** prescribes medicines or recommends dosages.
- ❌ **Never** invents symptoms, timelines, or medical history (`"Not mentioned by patient"` is enforced when absent).
- ✅ **Always** labels summaries as patient-prepared consultation aids—not verified medical records.
- 🚨 **Always** surfaces India emergency numbers (**108 / 112**) when urgent red-flag symptoms are detected.
