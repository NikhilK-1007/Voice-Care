# VoiceCare · Phase 2 & Phase 3

Everything here ships in the web app and the Android build. Nothing new needs a server
upgrade except the Supabase table (see `docs/SUPABASE-SETUP.md`); the backend change is only
the English translation pass.

---

## Phase 2

### 1. Doctor view (`Hamberger → Doctor view`, home tile “Doctor view”)
A single screen to hand to the doctor.

- One card per visit, newest first: patient name, age / gender / blood group / allergies,
  main concern, date and language.
- The patient's own urgent words are repeated at the top of the card.
- **Mark reviewed** flips the card to “Reviewed ✓” and stores `reviewedAt`.
- **Visit notes** opens the notes form for that visit.
- **Open summary** opens the full bilingual summary.
- Report photos appear as thumbnails on the card.

### 2. Visit notes (`Doctor view → Visit notes`, or from the visit)
- *What the doctor said* — free text, 600 characters.
- *Medicines prescribed* — free text, 400 characters.
- *Next visit* — a date.
- Saved locally first, then synced to `summaries.doctor_note`,
  `summaries.prescribed_medicines`, `summaries.next_visit_at`.
- The doctor's note is shown on the Doctor view card so the next visit starts with context.

### 3. Report & prescription photos
- **Add photo** uses the camera or the gallery (`capture="environment"`).
- Each photo is shrunk to at most 900 px and re-encoded as JPEG (~100 KB), so four photos
  cost less than one full-size camera photo.
- Max 4 per visit, stored per visit id (`voicecare_photos`) — editing or resaving a summary
  never touches the images.
- Removing a visit deletes its photos.

### 4. Timeline (home tile “Visit timeline”)
Every visit grouped by month, each with a dot (filled = reviewed), date, concern,
language and whether urgent words were present. Tapping a visit reopens its summary.

---

## Phase 3

### 5. Offline mode
- The app opens and the whole history, notes and photos keep working without a network
  (Capacitor serves the assets locally; the web build is served from the same origin).
- An amber banner appears the moment the phone goes offline.
- Tapping **Generate summary** while offline never fails silently: the description is saved
  as a draft and the patient is told to tap Generate again when the internet returns.
- Visit notes, review state and the Quick-Info Card all save instantly on the phone and are
  queued for cloud upload (a visit that exists only on the phone is now uploaded on the next
  sync instead of being dropped).

### 6. Data rules
- Supabase RLS: four policies so a patient can only read/write their own rows
  (`supabase/schema.sql`).
- Cloud delete tombstones: deleting a visit makes the next sync delete the cloud row, so it
  cannot come back.
- Quick-Info Card lives in account metadata, never inside a summary row.
- Guest mode never contacts Supabase.

### 7. Accessibility / polish
- New screens reuse the existing Large / Extra-large text, high-contrast and calm-display
  settings; every new button is at least 44 px tall and has a text label or `aria-label`.
- Doctor cards and timeline entries are real `<button>`s, so they work with a screen reader
  and with keyboard focus.
- Photos carry `alt` text (“Attached report photo”).

---

## Demo script (5 minutes)

1. **Home** → tap **Quick-Info Card** → fill name, age, blood group, allergy → **Save**.
   Point out the toast: the details now appear on every summary and PDF.
2. Tap **Speak** → tap the **sample** chip, or type in Hindi/Kannada.
   → **Generate summary** → answer one follow-up question → **Continue**.
3. On the summary: the **English version** is shown *first* when the input was not English;
   toggle **My exact words** to show what the patient actually said.
4. Urgent words (e.g. “सीने में दर्द”) appear in the red banner with
   “If this is an emergency, call 108.”
5. **Share PDF** → QR code, Download PDF, Copy text.
6. Back to **Home** → **Doctor view** → show the card → **Mark reviewed** →
   **Visit notes** → type what the doctor said, add a prescription photo → **Save**.
7. **Timeline** → the same visit appears under this month with a filled dot.
8. Turn off Wi-Fi → the offline banner appears → try **Generate** → the draft is kept,
   history and notes still open.
9. Sign in on a second device (same email) → **Settings → Cloud backup & sync** → the visits,
   notes and Quick-Info Card come back.
