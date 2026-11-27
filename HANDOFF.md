# VoiceCare — handoff brief

Written 2026-11-27. Read this before changing anything.

## What this project is

VoiceCare is an Android app (Capacitor + plain HTML/CSS/JS) for Indian patients. The
patient describes symptoms by typing or speaking in any Indian language; an Express
backend calls Google Gemini and returns an 8-section, doctor-friendly English summary.

**Product safety rules (must never be broken by any future change):**
- Never diagnose a disease, never prescribe medicine/dosage/treatment.
- Never invent symptoms, timelines, history or medications; missing details are written
  exactly as `Not mentioned by patient` (`NOT_MENTIONED` in `backend/services/safetyValidator.js`).
- Emergency red flags surface India helplines 108 / 112.
- Patient text is data, never instructions, inside any AI prompt.

## Layout

```
backend/                     Express API (plain CommonJS, no build step)
  server.js                  app wiring: CORS, helmet, rate limit 30 req/min,
                             /api/transcribe gets its own 12mb JSON body limit,
                             static serving of ../frontend/www
  routes/summary.js          POST /api/summarize
  routes/transcribe.js       POST /api/transcribe  (base64 audio -> text)
  services/geminiService.js  all Gemini calls: summary chain + transcribe chain
  services/safetyValidator.js schema enforcement / NOT_MENTIONED / red flags
  tests/api.test.js          node:test, 5 tests, all passing
  .env                       GEMINI_API_KEY (never commit, never paste in chat)
frontend/www/                the app UI that ships inside the APK
  js/config.js               API_BASE_URL + SUPABASE_CONFIG
  js/api.js                  fetch wrappers (health, summarize, transcribe)
  js/voice.js                MediaRecorder voice input
  js/supabase.js             auth: email/password + Google OAuth + deep link
  js/app.js                  screens, navigation, click handlers
  js/i18n.js                 en / hi / kn strings
frontend/android/            Capacitor Android project
dist/VoiceCare-debug.apk     latest debug build
```

## Environment variables (backend)

| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | required, from Google AI Studio |
| `ALLOW_DEMO_FALLBACK` | default true; local regex extractor when all models fail |
| `GEMINI_MODEL` | optional, first summary model |
| `GEMINI_MODEL_FALLBACKS` | optional, comma-separated |
| `GEMINI_TRANSCRIBE_MODEL` | optional, first transcription model |
| `ALLOWED_ORIGINS` | default `*` (Capacitor webview origin is `https://localhost`) |
| `PORT` / `HOST` | PORT defaults 3000, HOST defaults `0.0.0.0` |

## Done and verified

1. **In-app voice input** (replaced the old "install Wispr Flow" instructions).
   `voice.js` records via `MediaRecorder` (60 s cap, 700 ms minimum, 32 kbps mono opus),
   posts base64 to `/api/transcribe`, appends the transcript to the description box.
   Backend validates base64 length (min 800, max 9M chars) and an allow-list of mime types.
   Transcription prompt forbids translation/summarising and asks for an empty string on silence.
2. **Audio→text latency fixed.** Measured on the same 5 s clip, same endpoint:
   9.58 s before → 1.74 s after. Three causes fixed in `geminiService.js`:
   - transcription now sends `thinkingConfig: { thinkingLevel: 'low' }` (was absent, so the
     model ran a full reasoning pass first), with retry-without-it on HTTP 400;
   - new `getTranscribeChain()` puts lite models first instead of reusing the summary chain;
   - timeouts cut: 45 s → 20 s per attempt, 60 s → 25 s total budget.
   `voice.js` also records at 32 kbps so uploads are ~240 KB/minute instead of ~1 MB.
3. **Google sign-in** (Supabase OAuth + Android deep link), verified from the PC:
   - Supabase project `https://jrszguszetsejyxpcncw.supabase.co`, Google provider enabled,
     OAuth client ID `439941003444-n6orfcdk7eif64fe619vi94m0etmcln2.apps.googleusercontent.com`;
   - `GET /auth/v1/authorize?provider=google` 302s to `accounts.google.com` with
     `redirect_uri=https://jrszguszetsejyxpcncw.supabase.co/auth/v1/callback` (no mismatch);
   - the same response preserves `redirect_to=in.voicecare.app://auth-callback`, so that
     deep link is allow-listed in Supabase → Authentication → URL Configuration;
   - clicking the real `#btn-google-signin` button in the running app navigates to Google's
     account picker, so `index.html` → `app.js` handler → `signInWithGoogle()` is wired.
4. **Wispr Flow** fully removed from UI and README (only a negative assertion remains in tests).
5. **APK** `dist/VoiceCare-debug.apk` (4,302,715 bytes) contains `assets/public/js/voice.js`,
   `#btn-google-signin`, `signInWithGoogle` and the `in.voicecare.app://auth-callback`
   intent filter.

## Not done / open items

1. **Backend deployment (the main open task).** `frontend/www/js/config.js` still has
   `API_BASE_URL: 'http://192.168.1.9:3000'` — the developer's PC on the LAN. Any phone
   outside that Wi-Fi cannot reach the API, so summaries and voice fail. Planned fix:
   deploy `backend/` to Render free tier (root directory `backend`, build `npm install`,
   start `npm start`, env `GEMINI_API_KEY`, region Singapore), verify
   `https://<service>.onrender.com/api/health` returns `geminiConfigured: true`, then:
   - set `API_BASE_URL` to that https URL in `frontend/www/js/config.js`;
   - `cd frontend && npx cap sync android`;
   - remove `android:usesCleartextTraffic="true"` from
     `frontend/android/app/src/main/AndroidManifest.xml:10` (only needed for plain http);
   - rebuild and re-copy the APK to `dist/`.
   The project is **not a git repository**, so a repo has to be created and pushed before
   Render can deploy it. `backend/.env` must stay out of git.
2. **Not tested on a physical phone:** the Google consent round trip (redirect back into the
   app via `in.voicecare.app://auth-callback`) and real microphone capture/transcription.
   Everything upstream of those two steps is verified.
3. **Known model behaviour:** a silent or non-speech recording (e.g. a pure tone) can come
   back as an invented sentence instead of an empty transcript, even though the prompt asks
   for empty on silence. There is no speech-presence guard yet. If added, it must not block
   quiet or elderly speakers, and it must never invent text.
4. No version control, no CI.

## How to run and verify

```bash
# backend (PowerShell blocks npm.ps1, so use npm.cmd or node directly)
cd backend && node server.js            # http://127.0.0.1:3000
cd backend && npm.cmd test              # 5 tests must pass

# syntax check any touched frontend JS
node --check frontend/www/js/voice.js

# android build (Windows, Git Bash)
cd frontend && npx cap sync android
cd frontend/android && export JAVA_HOME="$LOCALAPPDATA/VoiceCareTools/jdk21" && ./gradlew.bat assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../../dist/VoiceCare-debug.apk
```

`adb` is at `C:\Users\TECRA X40\AppData\Local\Android\Sdk\platform-tools\adb.exe`.
Health check: `curl http://127.0.0.1:3000/api/health`.
The developer's machine Wi-Fi IPv4 was `192.168.1.9` and a firewall rule
"VoiceCare API 3000" already allows inbound 3000.

## Conventions to keep

- Backend stays plain CommonJS Express, no build step, no new framework.
- AI prompts keep the safety rules above verbatim in intent; never let the model diagnose.
- `Not mentioned by patient` is the only filler allowed for missing fields.
- Errors shown to patients stay plain-language and never leak keys or stack traces.
