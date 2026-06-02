-- supabase/migrations/20260602150000_m35_custom_venue_submissions.sql
-- M3.5: custom-venue promotion queue. When a host adds a real venue we don't carry
-- (via the /api/places/search proxy) as an inline itinerary stop, the pick is recorded
-- here for later admin curation into the canonical `places` table. The inline stop
-- carries a `custom:<googleId>` place_id and is NEVER auto-written to `places`.
--
-- RLS: owner-only write + read (submitted_by = auth.uid()); never using(true) on writes.
-- Admins read the queue via the service-role key, which bypasses RLS — no extra policy.
create table if not exists custom_venue_submissions (
  id              uuid primary key default gen_random_uuid(),
  submitted_by    uuid not null references profiles(id) on delete cascade,
  itinerary_id    uuid references itineraries(id) on delete set null,
  google_place_id text,
  name            text not null,
  lat             double precision,
  lng             double precision,
  raw             jsonb not null default '{}'::jsonb,
  status          text not null default 'pending' check (status in ('pending','promoted','rejected')),
  created_at      timestamptz not null default now()
);

alter table custom_venue_submissions enable row level security;

-- Single owner policy covers insert + select + update + delete on own rows.
-- using(...) gates read/update/delete to the owner; with check(...) gates insert/update
-- so a caller can only ever attribute a row to themselves. No public/anon policy.
create policy custom_venue_owner_write on custom_venue_submissions
  for all
  using (submitted_by = auth.uid())
  with check (submitted_by = auth.uid());
