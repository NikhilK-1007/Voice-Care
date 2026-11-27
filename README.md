# VoiceCare — AI-Powered Voice-First Healthcare Assistant

> **"Speak naturally. Let AI organise. Help your doctor understand."**

VoiceCare is a mobile-first healthcare communication assistant designed for Indian patients — especially elderly individuals, patients with limited typing comfort, and people speaking **Kannada, Hindi, English, or any other language** their phone can dictate.

## How Voice Input Works

VoiceCare records **inside the app** — nothing has to be installed first.

- **Speech to text:** the input screen has a microphone button (`#btn-voice`). It records a clip with the WebView's `MediaRecorder`, sends it to `POST /api/transcribe`, and our backend asks Gemini to transcribe it **in whatever language was spoken** (Tamil, Telugu, Bengali, Marathi, Malayalam, Urdu, Kannada, Hindi, English, Hinglish…). The transcript is appended to the text box, where the patient can fix any word.
- **Text to summary:** `frontend/www/js/api.js` sends the text to `POST /api/summarize`, and Gemini organises it into the 8-section doctor summary.
- **Privacy:** audio is sent to our own server only to be turned into text. Nothing is written to disk, and typing is always available instead.

| Piece | Where it lives |
| --- | --- |
| Microphone button, timer, status messages | `frontend/www/js/voice.js` + `#btn-voice` in `index.html` |
| Recording permission | `RECORD_AUDIO` in `frontend/android/app/src/main/AndroidManifest.xml` |
| Audio upload + size/format limits | `backend/routes/transcribe.js` (`12 MB` body limit, audio MIME allow-list) |
| Transcription prompt and model failover | `backend/services/geminiService.js` → `transcribeAudio()` |
| Language coverage | Any language: the instruction forbids translation and asks for the speaker's own script; the summarizer accepts any BCP-47 code or `auto` |

**Limits:** 60 seconds per recording, ~6.7 MB of audio. Longer descriptions should be typed or recorded in parts.

Rebuild the native app after changing web assets:

```bash
cd frontend
npm run prepare:vendor
npx cap sync android
```

### Google sign-in

Sign in uses Supabase OAuth (`js/supabase.js` → `signInWithGoogle()`), so the Google
client secret never touches the app.

1. **Google Cloud Console** → APIs & Services → Credentials → *Create OAuth client ID* →
   type **Web application**. Add the authorised redirect URI
   `https://<your-project>.supabase.co/auth/v1/callback`.
2. **Supabase** → Authentication → Providers → **Google** → paste the client ID and secret →
   enable.
3. **Supabase** → Authentication → URL Configuration → Redirect URLs → add
   `in.voicecare.app://auth-callback` (Android) and your web origin.
4. Android deep link: the `in.voicecare.app://auth-callback` intent-filter in
   `AndroidManifest.xml` plus `@capacitor/app` and `@capacitor/browser`.

On Android the consent screen opens in the system browser and the app is re-opened by the
deep link, where `setSession()` finishes the login. On the web build the page redirects and
`restoreSession()` picks the session up again on return.

### Patient Flow
1. Open VoiceCare and choose your on-screen language — **English, हिन्दी (Hindi), ಕನ್ನಡ (Kannada), or “Any other language”**. This only changes the app's own instructions; the health description itself can be dictated in any language.
2. Go to **Describe Health Concern**.
3. Tap the microphone button inside the app and speak (or type).
4. Tap again to stop — your words appear in the text box.
5. Review or fix any word manually, then tap **Generate Health Summary**.
6. VoiceCare sends the text to the secure Node.js backend, which calls the **Gemini API** to organise the description into 8 clear, doctor-friendly sections without diagnosing or inventing details.
7. Edit any section, confirm accuracy, and download/share a clean PDF with your doctor.

---

## Project Folder Structure

```text
Hackos project/
├── backend/
│   ├── package.json              # Express, CORS, Helmet, dotenv, rate-limit
│   ├── .env.example              # Environment variable template (copy to .env)
│   ├── server.js                 # Express server & static hosting for frontend/www
│   ├── routes/
│   │   └── summary.js            # POST /api/summarize & POST /api/regenerate
│   ├── services/
│   │   ├── geminiService.js      # Gemini API integration + offline demo fallback
│   │   └── safetyValidator.js    # 8-section schema & emergency warning checks
│   └── tests/
│       └── api.test.js           # Node.js automated backend tests
├── frontend/
│   ├── package.json              # Capacitor Android, Share, Filesystem, Notifications, jsPDF
│   ├── capacitor.config.json     # Capacitor mobile app config (webDir: "www")
│   ├── scripts/
│   │   └── copy-vendor.js        # Copies jsPDF into www/vendor/ for offline PDFs
│   └── www/
│       ├── index.html            # All 12 mobile screens
│       ├── assets/logo.svg       # VoiceCare vector icon
│       ├── css/styles.css        # Teal & mint elderly-friendly UI design system
│       └── js/
│           ├── config.js         # Backend URL resolver & optional Firebase config
│           ├── i18n.js           # English, Hindi, and Kannada UI text
│           ├── storage.js        # Local history, reminders & accessibility settings
│           ├── firebase.js       # Optional Firebase Auth & Firestore sync
│           ├── api.js            # Calls backend /api/health and /api/summarize
│           ├── pdf.js            # Generates PDFs & shares via Capacitor / Web Share
│           ├── notifications.js  # Medicine reminder notifications
│           └── app.js            # Screen navigation & full UI logic
└── README.md
```

---

## Step-by-Step Setup in VS Code (Beginner Friendly)

### Prerequisites
1. Install **Node.js (v18 or newer)** from [nodejs.org](https://nodejs.org/).
2. Install **Visual Studio Code** from [code.visualstudio.com](https://code.visualstudio.com/).
3. Get a free **Google Gemini API Key** from [Google AI Studio](https://aistudio.google.com/apikey).

### Step 1: Open the Project in VS Code
1. Open VS Code.
2. Click **File → Open Folder...** and select the `Hackos project` folder.
3. Open the VS Code terminal by pressing `` Ctrl + ` `` (or **Terminal → New Terminal**).

### Step 2: Set Up and Start the Backend
In the VS Code terminal, run:

```bash
cd backend
npm install
```

*(Note for Windows PowerShell users: if `npm` gives a script execution policy error, run `npm.cmd install` instead of `npm install`.)*

Now create your `.env` file:
1. Inside `backend/`, copy `.env.example` and rename the copy to `.env`.
2. Open `backend/.env` and replace `your_gemini_api_key_here` with your real Gemini API key:
   ```env
   PORT=3000
   GEMINI_API_KEY=AIzaSy...your_actual_key...
   GEMINI_MODEL=gemini-2.5-flash
   ALLOW_DEMO_FALLBACK=true
   ALLOWED_ORIGINS=*
   ```
   > **Note:** Even before adding your API key, `ALLOW_DEMO_FALLBACK=true` lets you test the entire UI in Offline Demo Mode!

Start the backend server:
```bash
npm start
```
You should see:
```text
VoiceCare backend running at http://localhost:3000
```

### Step 3: Prepare the Frontend Vendor Files (for Offline PDFs)
Open a second terminal in VS Code (or stop and run before starting) and run:
```bash
cd frontend
npm install
npm run prepare:vendor
```
This copies `jsPDF` into `frontend/www/vendor/jspdf.umd.min.js` so PDF downloads work even without internet inside the Android app.

### Step 4: Run & Test in Your Browser
1. Keep the backend running (`cd backend && npm start`).
2. Open Chrome or Edge and visit: **http://localhost:3000**
3. You can press `F12` in Chrome and click the **Toggle Device Toolbar** icon (`Ctrl + Shift + M`) to preview VoiceCare at mobile phone size!

---

## Testing Instructions

### 1. Automated Backend Tests
Run the built-in test suite inside `backend/`:
```bash
cd backend
npm test
```
This tests input validation, multilingual emergency red-flag detection (English/Hindi/Kannada), the 8-section summary schema, and `/api/health` + `/api/summarize`.

### 2. End-to-End Manual Walkthrough
1. **Splash & Guest Demo:** Wait 1.6s or click **Get Started**, enter an optional name (e.g., `Lakshmi Devi`), and tap **Continue as Guest**.
2. **Language Switch:** Tap **Language** on the dashboard and choose **ಕನ್ನಡ (Kannada)** or **हिन्दी (Hindi)** or **English**. Verify instructions update cleanly.
3. **Voice Input Screen:** Tap the large text box and either type, tap **Speak** to record your symptoms in any Indian language, OR tap **Try Sample Text** for instant testing.
4. **AI Health Summary:** Tap **Generate Health Summary**. Verify all 8 sections appear and missing details say `"Not mentioned by patient"`.
5. **Edit & Confirm:** Tap **Edit Summary**, tweak any field, check **Confirm before sharing**, and tap **Save & Preview PDF Report**.
6. **PDF & Share:** Tap **Download PDF Report**, **Copy Text Summary**, or **Share with Doctor**.
7. **Medicine Reminders & History:** Add a sample prescription reminder and check **Saved Summaries** to reopen past visits.

---

## Capacitor Android Setup (Mobile App Build)

### Prerequisites for Android
- Install **Android Studio** (includes Android SDK & Emulator).
- Ensure your backend is reachable from Android:
  - **Android Emulator:** Open **Settings** inside VoiceCare and set Backend Server URL to `http://10.0.2.2:3000`.
  - **Physical Android Phone (same Wi-Fi):** Find your PC's local IP (run `ipconfig` on Windows) and set Backend Server URL to `http://YOUR_PC_IP:3000`.

### Building the APK from the command line

The Capacitor 6 project needs a specific toolchain. On this machine:

| Piece | Version used | Why |
| --- | --- | --- |
| JDK | Temurin 21 (`%LOCALAPPDATA%\VoiceCareTools\jdk21`) | AGP 8.x rejects the machine's default JDK 26 |
| Gradle (wrapper) | 8.7 | The generated wrapper was 9.7.1, which no AGP 8.x supports |
| Android Gradle Plugin | 8.2.1 | Last version paired with Capacitor 6 |
| SDK | compileSdk / targetSdk 34, build-tools 34.0.0 | Installed on this machine |

From Git Bash:

```bash
cd frontend
npm run prepare:vendor
npx cap sync android
cd android
export JAVA_HOME="$LOCALAPPDATA/VoiceCareTools/jdk21"
./gradlew.bat assembleDebug
```

The APK lands at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`
(a copy is kept at `dist/VoiceCare-debug.apk`). Install it with:

```bash
adb install -r dist/VoiceCare-debug.apk
```

**Pointing the APK at your backend.** An installed app cannot reach `localhost` or
`10.0.2.2` (those only work in the emulator). Set the URL before building in
`frontend/www/js/config.js`:

```js
API_BASE_URL: 'http://192.168.1.9:3000'   // your PC's Wi-Fi IP, phone on the same network
```

Then re-run `npx cap sync android` and rebuild. For a shipped app use an HTTPS URL.

**Release build.** Generate a keystore once, then build `assembleRelease`:

```bash
cd frontend/android
keytool -genkeypair -v -keystore voicecare-release.jks -alias voicecare \
  -keyalg RSA -keysize 2048 -validity 10000
./gradlew.bat assembleRelease
```

Add `signingConfigs` to `app/build.gradle` (or sign in Android Studio
*Build → Generate Signed Bundle / APK*) and keep the keystore out of version control.

### Commands to Build & Open in Android Studio
Inside `frontend/`:
```bash
npm install
npm run prepare:vendor
npx cap add android
npx cap sync android
npx cap open android
```
*(If `android/` already exists later, just run `npm run cap:android`.)*

Inside Android Studio:
1. Wait for Gradle sync to finish.
2. Click the green **Run ▶** button to launch VoiceCare on your Android Emulator or USB-connected Android phone.
3. On Android, allow microphone access when asked, open VoiceCare, tap the health input box and tap **Speak** to dictate symptoms in Hindi, Kannada, Tamil, Telugu, Bengali, Marathi, English or any other Indian language.

---

## Optional Firebase Setup (Phase 2 Cloud Auth & Firestore)

VoiceCare works out of the box in **Guest Demo + Local Storage** mode. To enable cloud sign-in and Firestore sync:
1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and create a project.
2. Enable **Authentication → Email/Password** and create a **Firestore Database**.
3. Register a Web App in Firebase Project Settings and copy the `firebaseConfig` object.
4. Paste those values into `frontend/www/js/config.js` under `FIREBASE_CONFIG`.

---

## Healthcare Safety Principles

- VoiceCare **never** diagnoses diseases.
- VoiceCare **never** prescribes medicines or recommends dosages.
- VoiceCare **never** invents symptoms or medical history not mentioned by the patient.
- Every summary and PDF clearly states that it is a communication aid for doctor consultations and not a verified medical record.
- Emergency red-flag symptoms display India emergency numbers (**108 / 112**).
