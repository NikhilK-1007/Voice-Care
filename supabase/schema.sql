-- =====================================================================
-- VoiceCare · Supabase setup for the summaries table
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- Safe to run again: every statement is idempotent.
-- =====================================================================

-- 1. The table the app syncs each visit into.
create table if not exists public.summaries (
  -- The app creates ids like "vc_1764300000000", so this must be text.
  id                  text primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  patient_name        text not null default '',
  patient_text        text not null default '',
  language            text not null default 'en',
  language_label      text not null default 'English',
  -- The eight summary sections in the patient's own language.
  summary             jsonb not null default '{}'::jsonb,
  -- The same eight sections translated into English for the doctor.
  english_summary     jsonb,
  -- Patient's own red-flag words (never invented by the AI).
  urgent_flags        jsonb not null default '[]'::jsonb,
  -- What the AI still did not know at the time.
  missing_info        jsonb not null default '[]'::jsonb,
  -- Answers the patient gave to the follow-up questions.
  follow_up_answers   jsonb not null default '[]'::jsonb,
  -- Snapshot of the Quick-Info Card used for this visit.
  quick_info          jsonb not null default '{}'::jsonb,
  metadata            jsonb not null default '{}'::jsonb,
  confirmed           boolean not null default false,
  -- Doctor view: review state and visit notes.
  reviewed_at         timestamptz,
  doctor_note         text not null default '',
  prescribed_medicines text not null default '',
  next_visit_at       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 2. Add anything missing to a table created by an older version of the app.
alter table public.summaries add column if not exists patient_name         text not null default '';
alter table public.summaries add column if not exists patient_text         text not null default '';
alter table public.summaries add column if not exists language             text not null default 'en';
alter table public.summaries add column if not exists language_label       text not null default 'English';
alter table public.summaries add column if not exists summary              jsonb not null default '{}'::jsonb;
alter table public.summaries add column if not exists english_summary      jsonb;
alter table public.summaries add column if not exists urgent_flags         jsonb not null default '[]'::jsonb;
alter table public.summaries add column if not exists missing_info         jsonb not null default '[]'::jsonb;
alter table public.summaries add column if not exists follow_up_answers    jsonb not null default '[]'::jsonb;
alter table public.summaries add column if not exists quick_info           jsonb not null default '{}'::jsonb;
alter table public.summaries add column if not exists metadata             jsonb not null default '{}'::jsonb;
alter table public.summaries add column if not exists confirmed            boolean not null default false;
alter table public.summaries add column if not exists reviewed_at          timestamptz;
alter table public.summaries add column if not exists doctor_note          text not null default '';
alter table public.summaries add column if not exists prescribed_medicines text not null default '';
alter table public.summaries add column if not exists next_visit_at        date;
alter table public.summaries add column if not exists created_at           timestamptz not null default now();
alter table public.summaries add column if not exists updated_at           timestamptz not null default now();

-- 3. Fast "my visits, newest first" queries.
create index if not exists summaries_user_updated_idx
  on public.summaries (user_id, updated_at desc);

-- 4. Row Level Security: a patient can only ever touch their own rows.
--    This is what makes the public anon key in the app safe.
alter table public.summaries enable row level security;

drop policy if exists "summaries_select_own" on public.summaries;
create policy "summaries_select_own"
  on public.summaries for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "summaries_insert_own" on public.summaries;
create policy "summaries_insert_own"
  on public.summaries for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "summaries_update_own" on public.summaries;
create policy "summaries_update_own"
  on public.summaries for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "summaries_delete_own" on public.summaries;
create policy "summaries_delete_own"
  on public.summaries for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5. Keep updated_at honest even if a row is edited from the Supabase table UI.
create or replace function public.voicecare_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists summaries_touch_updated_at on public.summaries;
create trigger summaries_touch_updated_at
  before update on public.summaries
  for each row execute function public.voicecare_touch_updated_at();

-- =====================================================================
-- OPTIONAL RESET (only if your old table used a uuid id column and the app
-- cannot save). This deletes every stored summary for every user:
--
--   drop table if exists public.summaries cascade;
--
-- then run this whole file again from the top.
-- =====================================================================
