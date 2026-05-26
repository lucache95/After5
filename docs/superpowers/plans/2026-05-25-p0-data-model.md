SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P0 — Dating Core-Loop Data Model & Invariants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Stage mapping:** This plan is **S1 (Schema spine & fixtures)** in the RECONCILED-MASTER-PLAN build order. It owns the schema spine only. Migration band: `120000–1211xx` (C6).
>
> **Depends on:** the *existing* planner schema (`profiles`, `itineraries`, `places`, `set_updated_at()`) and Supabase `auth.users`. Nothing else in S1 depends on a later stage.
>
> **Consumed by (cross-stage, do NOT build here):** S2 (jobs/notifications/devices/`feature_config`/`offer_expires_at()`/`analytics_events`/`admin_alerts`/`can_enter_lock_flow`/chat-core), S6 (the C2 `match_*` RPCs that write the RPC-only lifecycle columns this stage ships), S12 (the canonical `browse_feed` finalization at band `133000`).

**Goal:** Lay the database foundation for the experience-first dating loop — the tables, enums, invariants, and RLS that every later phase (P1–P11) depends on — reconciled with the existing planner schema and the `date-engine-v2` proposal.

**Architecture:** Extend (never replace) the existing `profiles`, `itineraries` (the "date/night" content object), and `places` (the vetted "venue" layer). Add the dating-specific entities and enforce the two hard invariants **in the database**: (1) at most one *active offer per date instance*, via a partial unique index; (2) no user double-booked across *overlapping time windows*, via a `lock_participants` table with a GiST exclusion constraint over a `tstzrange`. All state transitions append to an immutable `audit_log`. Blind browsing is **not** built here — the identity-stripped `browse_feed` view is owned by S12 (C11.3); P0 ships only the base tables and the privacy-friendly columns it reads.

**Tech Stack:** Supabase Postgres, SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, `btree_gist` (for the exclusion constraint) and `postgis` (for `cities` geo + the Phase-4 distance filter), psql-based invariant tests run against the local stack.

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md`; roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md`; schema to reconcile `docs/superpowers/specs/2026-04-23-date-engine-v2-architecture-design.md` §4.

**Reconciliation note:** `date-engine-v2` proposes a single `matches` table (`state confirmed|…|ghosted`). The core-loop spec's richer lifecycle (`swipe → shortlist → offer → lock → standby`) supersedes it: a confirmed **`lock`** *is* "the match." We adopt `date-engine-v2`'s names where they fit (`cities`, `profiles_private`, `swipes`, `match_ratings`, `reports`) and add `queue_entries`, `offers`, `locks`, `lock_participants`, `blocks`, `disputes`, `verifications`, `audit_log`. **Out of scope for P0/S1 (owned by named later stages — referenced via the contract, never redefined here):** `browse_feed` view + `browse_feed_for_viewer()` RPC (S12, C11.3); the C2 `match_*` transition RPCs + `can_enter_lock_flow` (S6/S2); jobs/notifications/devices/`feature_config`/`analytics_events`/`admin_alerts`/chat-core (S2, C1/C11); `feed_cache`, embeddings/`vector`, `chat_messages` (S7, C9), bandit/outreach tables.

**Conventions (follow exactly):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql`; enable RLS on every table; create policies idempotently with `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`; attach the existing `set_updated_at()` trigger to tables with `updated_at`; `auth.uid()` in policies; uuid PKs via `gen_random_uuid()` except `profiles_private.user_id` which mirrors `profiles.id`.

**Local test loop:** `supabase db reset` (applies all migrations + seeds) then run a test file with:
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`
Tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior, so a clean exit = PASS and any raise = FAIL. Put tests in `supabase/tests/`.

---

## File Structure

- `supabase/migrations/2026052512NNNN_*.sql` — one migration per task (extensions, enums, tables, indexes, RLS). All within the P0 band `120000–1211xx` (C6). **No `browse_feed` migration here** (owned by S12, C11.3).
- `supabase/tests/_fixtures.sql` — C8 canonical fixtures (`mk_user`/`mk_itinerary`/`mk_instance`); every `p0_*` test `\i`'s it.
- `supabase/tests/p0_*.sql` — one invariant/RLS test file per task that warrants it.
- No application code in P0. Types regenerate later via `pnpm db:types`.

---

## Task 0: Shared test fixtures (`_fixtures.sql`) — C8

**Files:**
- Create: `supabase/tests/_fixtures.sql`

C8 (owner: P0/S1): every psql test `\i`'s this file. **No test inserts bare into `profiles`/`itineraries`** — those inserts violate the `profiles → auth.users` FK (`profiles.id REFERENCES auth.users(id)`) and abort before any invariant is exercised. These helpers seed a real `auth.users` row and satisfy all NOT-NULLs/FKs.

> This is the single source of truth for test users/itineraries/instances. The signatures below are canonical (C8/C11) — do not redefine them in individual test files.

- [ ] **Step 1: Write the fixtures helper**

```sql
-- supabase/tests/_fixtures.sql
-- C8 canonical fixtures. Every P0 test \i's this file, then calls mk_user/mk_itinerary/mk_instance.

create or replace function mk_user(p_label text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          p_label||'_'||left(uid::text,8)||'@test.local', now(), now());
  insert into profiles (id, first_name) values (uid, p_label);
  return uid;
end $$;

-- mk_itinerary: a minimal evergreen itinerary owned by p_user, satisfying itineraries NOT-NULLs.
create or replace function mk_itinerary(p_user uuid) returns uuid language plpgsql as $$
declare iid uuid;
begin
  insert into itineraries (id, user_id) values (gen_random_uuid(), p_user) returning id into iid;
  return iid;
end $$;

-- mk_instance: a concrete dated instance of p_itin, created by p_creator, in the 'kelowna' city
-- (seeded by Task 1), satisfying date_instances NOT-NULLs/FKs.
create or replace function mk_instance(p_itin uuid, p_creator uuid, p_starts timestamptz)
returns uuid language plpgsql as $$
declare did uuid; cid uuid;
begin
  select id into cid from cities where slug='kelowna';
  insert into date_instances (itinerary_id, creator_id, city_id, starts_at)
  values (p_itin, p_creator, cid, p_starts) returning id into did;
  return did;
end $$;
```

> NOTE: `mk_itinerary`/`mk_instance` reference `itineraries`/`date_instances`, which are created in Tasks 4. The file is harmless to `\i` once those tables exist; tests that use them run after Task 4. Adjust the column list only if a later S1 task adds a NOT-NULL to `itineraries`/`date_instances` (then update here, the single source).

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/_fixtures.sql
git commit -m "P0: canonical test fixtures (mk_user/mk_itinerary/mk_instance) seeding auth.users (C8)"
```

---

## Task 1: Extensions + `cities` (multi-city keying)

**Files:**
- Create: `supabase/migrations/20260525120000_p0_extensions_and_cities.sql`
- Test: `supabase/tests/p0_cities.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p0_cities.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_extension WHERE extname = 'btree_gist';
  IF NOT FOUND THEN RAISE EXCEPTION 'btree_gist not installed'; END IF;
  PERFORM 1 FROM pg_extension WHERE extname = 'postgis';
  IF NOT FOUND THEN RAISE EXCEPTION 'postgis not installed'; END IF;
  PERFORM 1 FROM cities WHERE slug = 'kelowna';
  IF NOT FOUND THEN RAISE EXCEPTION 'kelowna city seed missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p0_cities.sql`
Expected: FAIL — `relation "cities" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525120000_p0_extensions_and_cities.sql
create extension if not exists btree_gist;
create extension if not exists postgis;

create table if not exists cities (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  country text not null default 'CA',
  region text,
  timezone text not null,
  centroid geography(Point, 4326),
  default_radius_km int not null default 40,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_cities_updated_at before update on cities
  for each row execute function set_updated_at();

alter table cities enable row level security;
do $$ begin
  create policy "cities_public_read" on cities for select using (is_active = true);
exception when duplicate_object then null; end $$;

insert into cities (slug, name, region, timezone, centroid, is_active)
values ('kelowna','Kelowna','BC','America/Vancouver',
        ST_SetSRID(ST_MakePoint(-119.4960, 49.8880),4326)::geography, true)
on conflict (slug) do nothing;
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p0_cities.sql`
Expected: PASS (no output, exit 0).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525120000_p0_extensions_and_cities.sql supabase/tests/p0_cities.sql
git commit -m "P0: extensions (btree_gist, postgis) + cities table with Kelowna seed"
```

---

## Task 2: Extend `profiles` (dating) + `profiles_private` (PII, owner-only)

**Files:**
- Create: `supabase/migrations/20260525120100_p0_profiles_dating.sql`
- Test: `supabase/tests/p0_profiles_private.sql`

- [ ] **Step 1: Write the failing test** (owner-only RLS on `profiles_private`)

```sql
-- supabase/tests/p0_profiles_private.sql
-- Verifies the table exists and RLS is enabled (policy behavior is exercised by app integration tests).
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='profiles' AND column_name='dating_enabled';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.dating_enabled missing'; END IF;
  PERFORM 1 FROM pg_tables WHERE tablename='profiles_private' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles_private missing or RLS off'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`column ... does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525120100_p0_profiles_dating.sql
create type payment_preference as enum ('i_pay','they_pay','split');
create type verification_state as enum ('unverified','pending','verified','failed');

-- C3/C11.5 canonical account-state model: TWO orthogonal fields on profiles (not 3 tables).
--   standing       — moderation/reliability gate.   Owner of the WRITER ladder: S8 (P7/P8).
--   account_state  — lifecycle.                      Owner of the WRITER flows:  S10 (P9).
-- The ENUMS + COLUMNS are defined here in S1 (master-plan §6/§7) so can_enter_lock_flow
-- (S2) can read them before any consumer. Values are frozen by C3/C11.5 — do NOT add a 3rd
-- 'suspended' lifecycle value (suspension lives in standing='suspended', C11.5).
create type standing_state as enum
  ('good','warned','cooldown','throttled','reconfirm_required','locked_ban','suspended');
create type account_lifecycle as enum ('active','paused','deletion_pending','deleted');

alter table profiles
  add column if not exists primary_city_id uuid references cities(id),
  add column if not exists dating_enabled boolean not null default false,
  add column if not exists age int check (age is null or age >= 18),
  add column if not exists vibe_tags text[] not null default '{}',
  add column if not exists age_pref int4range,
  add column if not exists gender text,
  add column if not exists gender_preferences text[] not null default '{}',
  add column if not exists distance_pref_km int not null default 40,
  add column if not exists blurred_photo_url text,
  add column if not exists clear_photo_url text,
  add column if not exists reliability_score numeric(4,2),
  add column if not exists verification verification_state not null default 'unverified',
  -- C3/C11.5: the two account-state gate fields + the rollover freeze flag that
  -- can_enter_lock_flow(p_user) (S2) reads. Columns ship in S1; the ladders that WRITE
  -- standing (S8) and the lifecycle flows that write account_state (S10) come later.
  add column if not exists standing standing_state not null default 'good',
  add column if not exists account_state account_lifecycle not null default 'active',
  add column if not exists rollover_frozen boolean not null default false;

create table if not exists profiles_private (
  user_id uuid primary key references profiles(id) on delete cascade,
  full_name text,
  phone text,
  birthdate date,
  bio text,
  instagram_handle text,
  emergency_contact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_profiles_private_updated_at before update on profiles_private
  for each row execute function set_updated_at();

alter table profiles_private enable row level security;
do $$ begin
  create policy "profiles_private_owner_all" on profiles_private for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run test, expect PASS** (`supabase db reset && psql … -f supabase/tests/p0_profiles_private.sql`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525120100_p0_profiles_dating.sql supabase/tests/p0_profiles_private.sql
git commit -m "P0: extend profiles for dating (+ standing/account_state gate fields) + owner-only profiles_private"
```

---

## Task 3: `verifications`

**Files:**
- Create: `supabase/migrations/20260525120200_p0_verifications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525120200_p0_verifications.sql
create table if not exists verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('phone','selfie','age')),
  state verification_state not null default 'pending',
  provider text,
  provider_ref text,
  failure_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verifications_user_idx on verifications(user_id);
create trigger set_verifications_updated_at before update on verifications
  for each row execute function set_updated_at();

alter table verifications enable row level security;
do $$ begin
  create policy "verifications_owner_read" on verifications for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- writes are service-role only (verification vendor webhook); no insert/update policy.
```

- [ ] **Step 2: Apply, expect clean** (`supabase db reset`; expect no error).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525120200_p0_verifications.sql
git commit -m "P0: verifications table (phone/selfie/age), owner-read + service-write"
```

---

## Task 4: `date_instances` (scheduled night, with duration) + extend `itineraries`

**Files:**
- Create: `supabase/migrations/20260525120300_p0_date_instances.sql`
- Test: `supabase/tests/p0_date_instances.sql`

- [ ] **Step 1: Write the failing test** (a generated time-range column exists and is a `tstzrange`)

```sql
-- supabase/tests/p0_date_instances.sql
DO $$
DECLARE r tstzrange;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='date_instances' AND column_name='time_range';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances.time_range missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "date_instances" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525120300_p0_date_instances.sql
create type date_match_status as enum ('none','seeking','matched','completed','cancelled');

alter table itineraries
  add column if not exists city_id uuid references cities(id),
  add column if not exists is_evergreen boolean not null default true,
  add column if not exists match_status date_match_status not null default 'none',
  add column if not exists pay_setting payment_preference,
  add column if not exists ambient_sound_url text,
  add column if not exists why_note text,
  -- C7: the night object must carry vibe tags (the feed surfaces them). Without this column
  -- the canonical browse_feed CREATE VIEW would fail on `i.vibe_tags`. Required by C7/C11.3.
  add column if not exists vibe_tags text[] not null default '{}';

-- A scheduled instance is a concrete, dated occurrence of an (evergreen) itinerary.
create table if not exists date_instances (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references itineraries(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  city_id uuid not null references cities(id),
  venue_id uuid references places(id),
  starts_at timestamptz not null,
  duration_min int not null default 150 check (duration_min between 30 and 1440),
  time_range tstzrange generated always as
    (tstzrange(starts_at, starts_at + make_interval(mins => duration_min))) stored,
  status date_match_status not null default 'seeking',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists date_instances_creator_idx on date_instances(creator_id);
create index if not exists date_instances_city_status_idx on date_instances(city_id, status);
create index if not exists date_instances_range_gist on date_instances using gist (time_range);
create trigger set_date_instances_updated_at before update on date_instances
  for each row execute function set_updated_at();

alter table date_instances enable row level security;
do $$ begin
  create policy "date_instances_creator_all" on date_instances for all
    using (creator_id = auth.uid()) with check (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
-- NOTE: browsers never select date_instances directly. The blind feed (browse_feed) and the
-- client-facing browse_feed_for_viewer() RPC are owned by S12 (C11.3), not P0. P0 ships only
-- this base table; no feed view here.
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525120300_p0_date_instances.sql supabase/tests/p0_date_instances.sql
git commit -m "P0: date_instances (scheduled, generated time_range) + itineraries dating fields"
```

---

## Task 5: `swipes` (interest), with blind RLS

**Files:**
- Create: `supabase/migrations/20260525120400_p0_swipes.sql`
- Test: `supabase/tests/p0_swipes.sql`

- [ ] **Step 1: Write the failing test** (one swipe per swiper per instance)

```sql
-- supabase/tests/p0_swipes.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='swipes' AND indexdef ILIKE '%unique%swiper_id%date_instance_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'swipes unique(swiper,instance) missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525120400_p0_swipes.sql
create type swipe_direction as enum ('right','left');

create table if not exists swipes (
  id uuid primary key default gen_random_uuid(),
  swiper_id uuid not null references profiles(id) on delete cascade,
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade, -- denormalized
  direction swipe_direction not null,
  created_at timestamptz not null default now()
);
create unique index if not exists swipes_unique_swiper_instance
  on swipes (swiper_id, date_instance_id);
create index if not exists swipes_instance_idx on swipes(date_instance_id) where direction='right';

alter table swipes enable row level security;
do $$ begin
  create policy "swipes_swiper_insert" on swipes for insert
    with check (swiper_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- a swiper may read their own swipes; the creator may read right-swipes on THEIR instances
  create policy "swipes_visible" on swipes for select using (
    swiper_id = auth.uid()
    or (direction='right' and creator_id = auth.uid())
  );
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525120400_p0_swipes.sql supabase/tests/p0_swipes.sql
git commit -m "P0: swipes (interest) with unique(swiper,instance) + blind RLS"
```

---

## Task 6: `queue_entries` (shortlist, rank, standby)

**Files:**
- Create: `supabase/migrations/20260525120500_p0_queue_entries.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525120500_p0_queue_entries.sql
create type queue_status as enum ('interested','shortlisted','offer_active','offer_passed','offer_expired','standby','locked');

create table if not exists queue_entries (
  id uuid primary key default gen_random_uuid(),
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  candidate_id uuid not null references profiles(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  status queue_status not null default 'interested',
  rank int,                       -- creator-assigned; null until shortlisted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date_instance_id, candidate_id)
);
create index if not exists queue_entries_instance_rank_idx
  on queue_entries(date_instance_id, rank);
create trigger set_queue_entries_updated_at before update on queue_entries
  for each row execute function set_updated_at();

alter table queue_entries enable row level security;
-- C7: `queue_entries.status` (and `rank`) are lifecycle columns. They are NOT directly
-- writable by RLS — only the C2 match_* RPCs (S6, SECURITY DEFINER) mutate them. RLS grants
-- SELECT only; there is NO insert/update/delete policy (default deny). This closes the hole
-- where a creator could forge `status='locked'` or shortlist a candidate who never swiped.
do $$ begin
  -- creator reads the queue for their own instances (to triage); no write policy.
  create policy "queue_creator_read" on queue_entries for select
    using (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- candidate sees only their own row (no other candidates).
  create policy "queue_candidate_read_own" on queue_entries for select
    using (candidate_id = auth.uid());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 2: Apply, expect clean.**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525120500_p0_queue_entries.sql
git commit -m "P0: queue_entries (shortlist/rank/standby), RPC-only lifecycle, read-only RLS"
```

---

## Task 7: `offers` + INVARIANT "one active offer per instance"

**Files:**
- Create: `supabase/migrations/20260525120600_p0_offers.sql`
- Test: `supabase/tests/p0_offer_invariant.sql`

- [ ] **Step 1: Write the failing test** (second active offer on same instance must be rejected)

```sql
-- supabase/tests/p0_offer_invariant.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE inst uuid; cre uuid; a uuid; b uuid; itin uuid; ok boolean := false;
BEGIN
  -- C8 fixtures: mk_user seeds auth.users + profiles, so the profiles FK is satisfied
  -- and the invariant below is actually exercised (no FK abort).
  cre := mk_user('cre');
  a   := mk_user('a');
  b   := mk_user('b');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, a, cre, 'active', now()+interval '1 day');
  BEGIN
    insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
      values (inst, b, cre, 'active', now()+interval '1 day');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'INVARIANT FAILED: two active offers allowed on one instance'; END IF;
  RAISE NOTICE 'offer invariant OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "offers" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525120600_p0_offers.sql
create type offer_status as enum ('active','accepted','passed','expired');

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  candidate_id uuid not null references profiles(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  status offer_status not null default 'active',
  expires_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
-- INVARIANT 1: at most one ACTIVE offer per date instance.
create unique index if not exists offers_one_active_per_instance
  on offers (date_instance_id) where status = 'active';
create index if not exists offers_candidate_idx on offers(candidate_id);

alter table offers enable row level security;
do $$ begin
  create policy "offers_party_read" on offers for select
    using (candidate_id = auth.uid() or creator_id = auth.uid());
exception when duplicate_object then null; end $$;
-- offers are created/resolved by SECURITY DEFINER functions (Phase 5); no direct write policy.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `offer invariant OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525120600_p0_offers.sql supabase/tests/p0_offer_invariant.sql
git commit -m "P0: offers + partial-unique invariant (one active offer per instance)"
```

---

## Task 8: `locks` + `lock_participants` + INVARIANT "no overlapping double-booking"

**Files:**
- Create: `supabase/migrations/20260525120700_p0_locks.sql`
- Test: `supabase/tests/p0_lock_overlap.sql`

- [ ] **Step 1: Write the failing test** (same user cannot hold two active locks whose time ranges overlap)

```sql
-- supabase/tests/p0_lock_overlap.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; it1 uuid; it2 uuid; i1 uuid; i2 uuid; l1 uuid; ok boolean := false;
BEGIN
  -- C8 fixtures (seed auth.users + profiles so the invariant is actually exercised).
  cre := mk_user('cre');
  usr := mk_user('u');
  it1 := mk_itinerary(cre);
  i1  := mk_instance(it1, cre, timestamptz '2026-06-01 19:00Z');   -- duration default 150 min
  it2 := mk_itinerary(cre);
  i2  := mk_instance(it2, cre, timestamptz '2026-06-01 20:00Z');   -- overlaps i1
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (i1, cre, usr, 'active') returning id into l1;
  BEGIN
    insert into locks (date_instance_id, creator_id, matched_user_id, status)
      values (i2, cre, usr, 'active');  -- usr now double-booked on overlapping window
  EXCEPTION WHEN exclusion_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'INVARIANT FAILED: overlapping double-booking allowed'; END IF;
  RAISE NOTICE 'lock overlap invariant OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "locks" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525120700_p0_locks.sql
create type lock_status as enum ('active','completed','cancelled','no_show');
-- cancel_reason: canonical taxonomy is owned by C2 (the match transition API). It is
-- declared here because the locks table references it, but its VALUES are fixed by C2
-- and MUST NOT be invented locally. See C2. Includes 'account_closed' (S10 lifecycle uses it).
create type cancel_reason as enum
  ('schedule_conflict','venue_issue','changed_mind','account_closed','safety','misconduct','other');

create table if not exists locks (
  id uuid primary key default gen_random_uuid(),
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  matched_user_id uuid not null references profiles(id) on delete cascade,
  status lock_status not null default 'active',
  locked_at timestamptz not null default now(),
  cancelled_by uuid references profiles(id),
  cancel_reason cancel_reason,
  unique (date_instance_id)         -- a given night locks to exactly one pair
);
create trigger set_locks_updated_at before update on locks
  for each row execute function set_updated_at();

-- One participant row per (user, lock) carries the instance's time_range so a GiST
-- exclusion constraint can forbid a user holding two ACTIVE overlapping commitments.
create table if not exists lock_participants (
  lock_id uuid not null references locks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  time_range tstzrange not null,
  active boolean not null default true,
  primary key (lock_id, user_id),
  exclude using gist (user_id with =, time_range with &&) where (active)
);

-- Keep lock_participants in sync with locks via trigger (both creator + matched user).
create or replace function sync_lock_participants() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare rng tstzrange;
begin
  select time_range into rng from date_instances where id = new.date_instance_id;
  if (tg_op = 'INSERT') then
    insert into lock_participants(lock_id,user_id,time_range,active)
    values (new.id,new.creator_id,rng,new.status='active'),
           (new.id,new.matched_user_id,rng,new.status='active');
  elsif (tg_op = 'UPDATE') then
    update lock_participants set active = (new.status='active') where lock_id = new.id;
  end if;
  return new;
end $fn$;
create trigger locks_sync_participants after insert or update on locks
  for each row execute function sync_lock_participants();

alter table locks enable row level security;
alter table lock_participants enable row level security;
do $$ begin
  create policy "locks_party_read" on locks for select
    using (creator_id = auth.uid() or matched_user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "lock_participants_self_read" on lock_participants for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `lock overlap invariant OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525120700_p0_locks.sql supabase/tests/p0_lock_overlap.sql
git commit -m "P0: locks + lock_participants GiST exclusion (no overlapping double-booking)"
```

---

## Task 9: `match_ratings` (structured, anti-retaliation)

**Files:**
- Create: `supabase/migrations/20260525120800_p0_match_ratings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525120800_p0_match_ratings.sql
create table if not exists match_ratings (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  rater_id uuid not null references profiles(id) on delete cascade,
  ratee_id uuid not null references profiles(id) on delete cascade,
  showed_up boolean,
  on_time boolean,
  cancelled_with_notice boolean,
  unsafe_or_disrespectful boolean,
  submitted_at timestamptz not null default now(),
  unique (lock_id, rater_id)         -- one rating per rater per locked date
);
create index if not exists match_ratings_ratee_idx on match_ratings(ratee_id);

alter table match_ratings enable row level security;
do $$ begin
  create policy "match_ratings_rater_insert" on match_ratings for insert
    with check (rater_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- raters read only their own submission (blind-until-both is enforced in the read API);
  -- aggregate reliability is exposed via profiles.reliability_score, not raw rows.
  create policy "match_ratings_rater_read_own" on match_ratings for select
    using (rater_id = auth.uid());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 2: Apply, expect clean.**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525120800_p0_match_ratings.sql
git commit -m "P0: match_ratings (structured outcomes, one-per-rater, blind-read RLS)"
```

---

## Task 10: `reports` + `disputes` + `blocks` (canonical C5/C11.6 DDL)

**Files:**
- Create: `supabase/migrations/20260525120900_p0_reports_blocks.sql`
- Test: `supabase/tests/p0_blocks.sql`

**Conformance (C5 / C11.6 / master-plan §6 "reports/disputes DDL moves to S1"):** the `reports`/`disputes` shapes, the `report_status` enum, and the `report_reason_category` taxonomy are **canonical and frozen** in C5/C11.6. P0/S1 ships them verbatim; later phases conform and never rename/drop values.
- `report_status` enum = exactly `('open','reviewing','actioned','dismissed')` — P7 reads `actioned`/`reviewing`; do NOT drop/rename. Richer P8 lifecycle is expressed via `resolution_code text`, never by mutating this enum.
- `report_reason_category` is the canonical taxonomy (C5). `detail text` is free-text; there is **no** separate gating `reason` column.
- Canonical report writer `file_report(...)` is owned by S9 (P8) per C5; P0 only ships the table/enums.
- `disputes` DDL is verbatim from C11.6 (P7 writes a row on a contested no-show; S9/P8 resolution updates `disputes.state` and calls back `recompute_reliability`). Owner-band note: C11.6 nominally bands `disputes` in P7 (`128xxx`), but master-plan §6/§7 pull the DDL forward into S1 so the schema spine is self-contained; the *writer/resolver RPCs* remain S8/S9. Defined here once; not redefined later.

- [ ] **Step 1: Write the failing test** (block is unique per pair)

```sql
-- supabase/tests/p0_blocks.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='blocks' AND indexdef ILIKE '%unique%blocker_id%blocked_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'blocks unique(blocker,blocked) missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525120900_p0_reports_blocks.sql
create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (blocker_id <> blocked_id)
);
create unique index if not exists blocks_unique_blocker_blocked
  on blocks (blocker_id, blocked_id);

-- C5/C11.6 canonical enums (frozen taxonomy + 4-value status).
create type report_status as enum ('open','reviewing','actioned','dismissed');
create type report_reason_category as enum
  ('harassment','safety_threat','no_show_dispute','payment_dispute','inappropriate_content','fake_profile','other');

-- C5/C11.6 canonical reports shape. target_id is intentionally FK-less (polymorphic).
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete set null,
  target_type text not null check (target_type in ('user','date_instance','message','lock')),
  target_id uuid not null,
  reason_category report_reason_category not null,
  detail text,
  status report_status not null default 'open',
  resolution_code text,
  pay_setting_snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on reports(status);

-- C11.6 canonical disputes DDL (verbatim).
create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  raised_by uuid not null references profiles(id),
  kind text not null check (kind in ('no_show','payment','conduct')),
  state text not null default 'open' check (state in ('open','resolved','rejected')),
  resolution jsonb,
  created_at timestamptz not null default now()
);
create index if not exists disputes_lock_idx on disputes(lock_id);

alter table blocks enable row level security;
alter table reports enable row level security;
alter table disputes enable row level security;
do $$ begin
  create policy "blocks_owner_all" on blocks for all
    using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- reporters insert via file_report (S9) which asserts auth.uid(); direct insert is gated to self.
  create policy "reports_reporter_insert" on reports for insert
    with check (reporter_id = auth.uid());
exception when duplicate_object then null; end $$;
-- report/dispute review/read is service-role/admin only (no select policy = default deny).
-- disputes writes happen via S8 (raise) / S9 (resolve) RPCs; no direct write policy here.
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525120900_p0_reports_blocks.sql supabase/tests/p0_blocks.sql
git commit -m "P0: blocks (unique pair) + reports + disputes (canonical C5/C11.6 DDL)"
```

---

## Task 11: ~~Blind-browse feed view~~ — SUPERSEDED by C11.3

**SUPERSEDED by C11.3.** The canonical `browse_feed` is **not** owned by P0/S1. It is built **exactly once** in the S12 feed-finalization migration at band `133000`, via `drop view if exists browse_feed; create view …` (NOT `create or replace`), after every base-table column it reads exists (`moderation_status` S4, `is_seed` S4, `account_state`/`standing` S7/S9 per C3/C11.5). No P0 migration may `create or replace browse_feed`; P0 only ships the **base tables** the view reads (`date_instances`, `itineraries` incl. `vibe_tags`, `places`). See C4 and C11.3.

**Do NOT build a `browse_feed` view in P0.** This removes the build-breaker (the original P0 view selected `i.vibe_tags` before the column existed — now fixed in Task 4 — and duplicated a view that C11.3 reserves for S12 with a mandatory filter P0 cannot yet satisfy, e.g. `moderation_status='approved'`, `account_state='active'`, `standing not in (...)`).

If an early stage genuinely needs a feed for tests, query the **base tables** directly (per C11.3). This task ships **no** view and **no** test file.

> NOTE: The old `supabase/tests/p0_feed_blind.sql` test is removed with this task — it asserted only `information_schema` column presence on a view that returned zero rows for browsers (security_invoker + creator-only RLS), so it guarded nothing. Blind-feed behavior is proven in S12 against the canonical view + `browse_feed_for_viewer()` RPC (C11.3).

---

## Task 12: `audit_log` + generic transition trigger

**Files:**
- Create: `supabase/migrations/20260525121100_p0_audit_log.sql`
- Test: `supabase/tests/p0_audit_log.sql`

- [ ] **Step 1: Write the failing test** (a status change on a lock writes an audit row)

```sql
-- supabase/tests/p0_audit_log.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; l uuid; n int;
BEGIN
  cre := mk_user('c');
  usr := mk_user('u');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '3 days');
  insert into locks (date_instance_id,creator_id,matched_user_id) values (inst,cre,usr) returning id into l;
  update locks set status='completed' where id=l;
  select count(*) into n from audit_log where entity='locks' and entity_id=l;
  IF n < 1 THEN RAISE EXCEPTION 'audit_log did not capture lock transition'; END IF;
  RAISE NOTICE 'audit_log OK (% rows)', n;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "audit_log" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525121100_p0_audit_log.sql
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  entity text not null,
  entity_id uuid not null,
  action text not null,            -- 'insert' | 'status_change'
  old_status text,
  new_status text,
  actor uuid,                      -- auth.uid() when available
  at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on audit_log(entity, entity_id);

create or replace function log_status_transition() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if (tg_op='INSERT') then
    insert into audit_log(entity,entity_id,action,new_status,actor)
    values (tg_table_name, new.id, 'insert', new.status::text, auth.uid());
  elsif (tg_op='UPDATE' and new.status is distinct from old.status) then
    insert into audit_log(entity,entity_id,action,old_status,new_status,actor)
    values (tg_table_name, new.id, 'status_change', old.status::text, new.status::text, auth.uid());
  end if;
  return new;
end $fn$;

create trigger audit_locks after insert or update on locks
  for each row execute function log_status_transition();
create trigger audit_offers after insert or update on offers
  for each row execute function log_status_transition();
create trigger audit_queue after insert or update on queue_entries
  for each row execute function log_status_transition();
create trigger audit_date_instances after insert or update on date_instances
  for each row execute function log_status_transition();

alter table audit_log enable row level security;  -- no policies: admin/service-role read only.
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `audit_log OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525121100_p0_audit_log.sql supabase/tests/p0_audit_log.sql
git commit -m "P0: append-only audit_log + status-transition triggers on loop tables"
```

---

## Task 13: Regenerate types + full reset verification

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset (applies every P0 migration + seeds)**

Run: `supabase db reset`
Expected: completes with no error; all migrations apply in order.

- [ ] **Step 2: Run all P0 tests**

Run:
```bash
for f in supabase/tests/p0_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` updates to include `cities`, `date_instances`, `swipes`, `queue_entries`, `offers`, `locks`, `lock_participants`, `match_ratings`, `disputes`, `reports`, `blocks`, `verifications`, `audit_log`. (No `browse_feed` — that view is owned by S12, C11.3.)

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P0: regenerate database types for dating core-loop schema"
```

---

## Self-Review

**Spec coverage (vs roadmap P0 'Closes' list / RECONCILED-MASTER-PLAN S1):**
- Shared test fixtures (C8) → Task 0 (`_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance`). ✅
- Data model / schema → Tasks 1–12 (minus the removed feed view). ✅
- `vibe_tags` on the night object (C7) → Task 4 (`itineraries.vibe_tags`). ✅
- Account-state model (C3/C11.5) → Task 2 (`standing` + `account_state` + `rollover_frozen` + enums; columns the S2 `can_enter_lock_flow` reads). ✅
- Date duration / "overlapping window" definable → Task 4 (`time_range` generated col) + Task 8 (exclusion constraint). ✅
- Concurrency / single-offer invariant → Task 7 partial unique index. ✅
- No double-booking invariant → Task 8 GiST exclusion on `lock_participants`. ✅
- RPC-only lifecycle columns (C7) → Task 6 (`queue_entries` read-only RLS, no FOR ALL) + Task 8 (`locks` read-only RLS). ✅
- Standby vs creator-rank ambiguity → Task 6 `queue_entries.rank` + `status` (written only by S6 RPCs). ✅
- Reliability score backed by events → Task 9 `match_ratings` (raw structured rows; aggregate in S8). ✅
- Audit log / event sourcing → Task 12. ✅
- Verification storage / age gate field → Tasks 2–3. ✅
- Reports/disputes/blocks (canonical C5/C11.6) → Task 10. ✅
- Multi-city keying → Task 1 `cities`. ✅

**Owned elsewhere (NOT in P0/S1 — referenced, not redefined):**
- `browse_feed` view + `browse_feed_for_viewer()` RPC → **S12** finalization at band `133000` (C4/C11.3). P0 ships only the base tables it reads.
- offer/lock *transition functions* and the C2 `match_*` SECURITY DEFINER RPCs (incl. `match_withdraw`, `match_resolve_reciprocal`) → **S6** (C2). They are the sole writers of `queue_entries.status`/`rank` and `locks.status`.
- `can_enter_lock_flow(p_user)` gate (reads `account_state`/`standing`/`rollover_frozen`) → **S2** (C3).
- jobs/runner, notifications/devices/preferences, `feature_config`/`offer_expires_at()`, `analytics_events`, `admin_alerts`, chat-core hooks → **S2** (C1/C11.1/C11.7/C11.8).
- chat tables / rich messaging → **S7** (C9). reliability computation + enforcement ladder writing `standing` → **S8**. `file_report` writer + dispute resolution → **S9**. lifecycle flows writing `account_state` → **S10**.
- `cancel_reason` enum values are owned by **C2** (declared in Task 8 only because `locks` references the type).

**Placeholder scan:** none — every step has runnable SQL and exact commands. The former `browse_feed` task is intentionally a SUPERSEDED no-op (no dead view shipped).

**Type/name consistency:** names referenced across tasks are consistent with the contract (`date_instances.time_range`, `offers.status='active'`, `locks`/`lock_participants`, `queue_status`, `report_status`, `report_reason_category`, `standing_state`, `account_lifecycle`, `cancel_reason`). Enums declared once before use; canonical enums match C3/C5/C11.6 verbatim.

**Risk note (corrected):** earlier drafts inserted directly into `profiles` (bypassing `auth.users`), which actually **violates** the `profiles.id → auth.users(id)` FK and aborts the test before the invariant runs. That is fixed: all DB tests now `\i supabase/tests/_fixtures.sql` and create users via `mk_user()` (C8), which seeds a real `auth.users` row. RLS *policy behavior* (`auth.uid()`) is verified by app-level integration tests in later stages, not these structural tests.
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p0-data-model.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.
