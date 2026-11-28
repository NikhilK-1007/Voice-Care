# VoiceCare · Supabase setup (summaries table)

The app works fully offline without this. Supabase only adds **backup + sync across phones**
and the **Doctor view / timeline / visit notes** on a new device.

---

## 1. Open the SQL editor

1. Go to <https://supabase.com/dashboard> and open the VoiceCare project
   (`jrszguszetsejyxpcncw`).
2. Left sidebar → **SQL Editor** → **New query**.
3. Open the file `supabase/schema.sql` from this repository, copy **all** of it, paste it in.
4. Click **Run** (or press `Ctrl/Cmd + Enter`).

You should see `Success. No rows returned`.

## 2. Check the table

1. Left sidebar → **Table Editor** → `summaries`.
2. You should see these columns:
   `id`, `user_id`, `patient_name`, `patient_text`, `language`, `language_label`,
   `summary`, `english_summary`, `urgent_flags`, `missing_info`, `follow_up_answers`,
   `quick_info`, `metadata`, `confirmed`, `reviewed_at`, `doctor_note`,
   `prescribed_medicines`, `next_visit_at`, `created_at`, `updated_at`.

If a column is missing, run the `alter table ... add column if not exists ...` lines again
(they are in step 2 of `schema.sql`).

## 3. Check Row Level Security

1. **Authentication → Policies** → `summaries`.
2. There must be four policies: `summaries_select_own`, `summaries_insert_own`,
   `summaries_update_own`, `summaries_delete_own`.
3. RLS itself must say **Enabled** (Table Editor → `summaries` → the lock icon).

Without these, either nothing saves or every user can read every other user's health data.

## 4. Check the `id` column type

`id` **must be `text`**, not `uuid`. The app generates ids like `vc_1764300000000`, which are
not valid UUIDs, so a `uuid` column rejects every save.

- Table Editor → `summaries` → column `id` → it should read `text`.
- If it says `uuid`, run the reset at the bottom of `schema.sql` (this deletes existing
  cloud summaries) and run the whole file again.

## 5. Test it in the app

1. Sign in with an email account (not guest mode — guests never sync).
2. Settings → **Cloud backup & sync** → tap it. You should see
   “Synced (N saved summaries)”.
3. In the Supabase Table Editor, refresh `summaries`: one row per visit, with your
   `user_id`, the eight sections in `summary`, and the English translation in
   `english_summary`.
4. On the phone: tap **Save my information**, then **Doctor view** → **Visit notes**.
   Both should appear on the row within a few seconds (`quick_info`, `doctor_note`).

If you see “Sync issue: …” in the app:

| Message contains | Meaning | Fix |
| --- | --- | --- |
| `row-level security` | Policies missing or wrong | Re-run step 4 of `schema.sql` |
| `column … does not exist` / `schema cache` | Table not migrated | Re-run steps 1–2 |
| `invalid input syntax for type uuid` | `id` column is `uuid` | See step 4 above |
| `JWT expired` | Signed-out session | Sign out and sign in again |

---

## What is stored where

| Data | Storage |
| --- | --- |
| Visits (summary, English version, urgent words, Q&A, review state) | Supabase `summaries` table, one row per visit |
| Quick-Info Card (name, age, blood group, allergies, emergency contact) | on the phone **and** in the Supabase user profile (`user_metadata.voicecare_profile`) — never inside a summary row |
| Report / prescription photos | on the phone only (compressed to ~100 KB each, max 4 per visit) |
| Delete a visit | removed on the phone immediately; the id is remembered so the cloud copy is deleted on the next sync |

Guest mode never talks to Supabase: everything stays in the phone's local storage.
