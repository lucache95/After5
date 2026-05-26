# P3 — Date Creation & Content Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the creation surface and content supply for the dating loop on top of P0's tables. Deliver (1) an **evergreen idea** creation flow (an itinerary as a browsable template, seeded by the existing generator as a "first draft," then personalized: venue swaps, vibe, the "why" note, opener, pay setting); (2) a **scheduled instance** creation flow (`date_instances`) including the **evergreen→scheduled conversion** that **re-collects availability** so "I liked the idea but not that time" can't happen; and (3) a **media pipeline** — Supabase Storage buckets for place photos + ambient audio, a transcode/CDN step, a **moderation queue** ingestion point (consumed in P8), and a **curated ambient-sound library** (`sounds` table + seed). Google Places photos stay fetched live, not persisted (existing convention).

**Architecture:** Extend (never replace) P0's `itineraries` (evergreen content object), `date_instances` (scheduled night), `places` (vetted venues), and `audit_log`. Add: `sounds` (curated audio library, source/licensing tracked), `media_assets` (UGC + generated photo/audio rows with moderation state), `availability_windows` (a creator's recollected availability, the join between an evergreen idea and a concrete instance), and an `evergreen→scheduled` SECURITY DEFINER RPC that demands a fresh availability window. The existing `generate-plan` Edge Function is the *first draft only*; personalization is a set of column writes on the creator's own `itineraries` row, RLS-guarded to the owner. Media uploads land in private buckets, get a `media_assets` row at `moderation_state='pending'`, are transcoded by a new `process-media` Edge Function (image → webp via Storage transform convention already used by `generate-cover`; audio → normalized/clipped), and only `moderation_state='approved'` assets are referenced by `ambient_sound_url` / place photo fields. **Curated library sounds bypass UGC moderation** (they ship pre-cleared with licensing).

**Tech Stack:** Supabase Postgres + SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, Storage buckets created **in-migration** via `storage.buckets` inserts + `storage.objects` RLS (the repo currently creates `itinerary-covers` out-of-band — P3 fixes that by declaring buckets in migrations). Edge Functions on Deno (std http server, `esm.sh/@supabase/supabase-js@2.45.0`, `npm:zod`), tested with `Deno.test`. Pure TS helpers (availability validation, sound-library selection, conversion guards) live in `packages/business` and are tested with **vitest** (added in Task 0 — the repo has no test runner yet; the brief instructs to assume it exists, so we install it minimally and wire `pnpm test`). psql for DB invariant/RLS tests, matching P0.

**Source docs:**
- Spec: `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§4 date object, evergreen→scheduled, pre-lock privacy; §5 ambient sound; §10 ambient-autoplay/native).
- Roadmap: `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 3 scope + Closes).
- Foundation: `docs/superpowers/plans/2026-05-25-p0-data-model.md` (build on `itineraries`, `date_instances`, `places`, `cities`, `audit_log`).
- Generator: `docs/superpowers/specs/2026-04-23-date-plan-generator-deep-dive.md` + `supabase/functions/generate-plan/`.

**Reconciliation note (build on P0, do not duplicate):** P0 already added to `itineraries`: `city_id`, `is_evergreen`, `match_status`, `pay_setting` (`payment_preference` enum), `ambient_sound_url`, `why_note`. P0 already created `date_instances` (`itinerary_id`, `creator_id`, `city_id`, `venue_id`, `starts_at`, `duration_min`, generated `time_range`, `status date_match_status`) and `browse_feed` (which already projects `pay_setting`, `vibe_tags`, `why_note`, `ambient_sound_url`, `venue_neighborhood`). P3 therefore **adds only what's missing**: an `opener` field + a personalization marker on `itineraries`; the `sounds`, `media_assets`, `availability_windows` tables; the conversion + audio-attach RPCs; and the media-processing Edge Function. Where a column already exists in P0, P3 uses `ADD COLUMN IF NOT EXISTS` and never redefines it.

**Conventions (follow P0 exactly):** migration filenames `YYYYMMDDHHMMSS_p3_snake_description.sql`; enable RLS on every table; create policies idempotently with `do $$ begin create policy … exception when duplicate_object then null; end $$;`; attach the existing `set_updated_at()` trigger to every table with `updated_at`; `auth.uid()` in policies; uuid PKs via `gen_random_uuid()`; status-changing tables get an `audit_log` trigger via P0's `log_status_transition()`.

**Local test loops:**
- DB: `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>` (a `DO $$ … RAISE EXCEPTION …` block: clean exit = PASS, any raise = FAIL). Tests in `supabase/tests/`.
- Edge Functions: `deno test --allow-env --allow-net supabase/functions/<fn>/*_test.ts` (pure-logic tests run with no flags).
- Shared TS: `pnpm --filter @after5/business test` (vitest, added Task 0).

---

## File Structure

- `supabase/migrations/2026052613NNNN_p3_*.sql` — one migration per schema task (buckets, sounds, media_assets, availability_windows, itineraries.opener, conversion RPC, attach-audio RPC, browse_feed v2).
- `supabase/seed.sql` — append the curated `sounds` seed (config already loads `./seed.sql`).
- `supabase/tests/p3_*.sql` — one psql invariant/RLS test file per task that warrants it.
- `supabase/functions/process-media/index.ts` + `process_media_test.ts` — transcode/normalize uploads, flip `media_assets` to `processed`, enqueue moderation.
- `supabase/functions/_shared/media.ts` — shared upload/transform helpers (image webp, audio clip) reused by `process-media`.
- `packages/business/src/availability.ts` + `availability.test.ts` — availability-window validation (timezone-aware, no past windows, min lead time).
- `packages/business/src/conversion.ts` + `conversion.test.ts` — evergreen→scheduled guard (a fresh window is required; chosen `starts_at` must fall inside a window).
- `packages/business/src/sounds.ts` + `sounds.test.ts` — curated sound-library selection + license display helper.
- `packages/business/package.json`, `packages/business/vitest.config.ts`, root `package.json` — add vitest (Task 0).
- `packages/types/src/database.ts` — regenerated last (`pnpm db:types`).

---

## Task 0: Add a vitest runner to `packages/business`

**Why first:** several P3 tasks are pure TS logic (availability rules, conversion guard, sound selection). The repo has **no JS test runner** today. The brief says assume vitest exists; we make that true here so later tasks can write failing TS tests.

**Files:**
- Modify: `packages/business/package.json`
- Create: `packages/business/vitest.config.ts`
- Create: `packages/business/src/smoke.test.ts`
- Modify: `package.json` (root — add `"test": "turbo run test"`)
- Modify: `turbo.json` (add a `test` task)

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('vitest wiring', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm --filter @after5/business test` fails with `vitest: command not found` / unknown script.

- [ ] **Step 3: Wire it up.**
  - In `packages/business/package.json` add to `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`; add `"vitest": "^2.1.0"` to `devDependencies`.
  - `packages/business/vitest.config.ts`:
    ```ts
    import { defineConfig } from 'vitest/config';
    export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });
    ```
  - Root `package.json` `scripts`: add `"test": "turbo run test"`.
  - `turbo.json` `tasks`: add `"test": { "dependsOn": ["^build"] }` (mirror existing task shape).
  - Run `pnpm install` to materialize vitest.

- [ ] **Step 4: Run it, expect PASS** — `pnpm --filter @after5/business test` → 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add packages/business/package.json packages/business/vitest.config.ts packages/business/src/smoke.test.ts package.json turbo.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
P3: add vitest runner to @after5/business for shared-logic TDD

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Storage buckets (place-photos, ambient-audio) declared in-migration

**Why:** the media pipeline needs durable, RLS-guarded buckets. The repo creates `itinerary-covers` out-of-band; P3 standardizes by declaring buckets in a migration so `supabase db reset` reproduces them. `place-photos` and `ambient-audio` are **private** (objects served via signed URLs / CDN after moderation); uploads are owner-scoped by a path prefix `{auth.uid()}/…`.

**Files:**
- Create: `supabase/migrations/20260526130000_p3_storage_buckets.sql`
- Test: `supabase/tests/p3_buckets.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p3_buckets.sql
DO $$
BEGIN
  PERFORM 1 FROM storage.buckets WHERE id = 'place-photos';
  IF NOT FOUND THEN RAISE EXCEPTION 'place-photos bucket missing'; END IF;
  PERFORM 1 FROM storage.buckets WHERE id = 'ambient-audio';
  IF NOT FOUND THEN RAISE EXCEPTION 'ambient-audio bucket missing'; END IF;
  -- both private (public=false) — served via signed URL post-moderation
  PERFORM 1 FROM storage.buckets WHERE id IN ('place-photos','ambient-audio') AND public = true;
  IF FOUND THEN RAISE EXCEPTION 'media buckets must be private (public=false)'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`place-photos bucket missing`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130000_p3_storage_buckets.sql
-- Private media buckets. file_size_limit + allowed_mime_types enforced at the
-- Storage layer; UGC is still gated by media_assets.moderation_state (Task 3).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('place-photos','place-photos', false, 10485760,  -- 10 MiB
   array['image/jpeg','image/png','image/webp','image/heic']),
  ('ambient-audio','ambient-audio', false, 15728640, -- 15 MiB
   array['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/webm'])
on conflict (id) do nothing;

-- Owner-scoped writes: object path MUST be prefixed with the uploader's uid,
-- i.e. '<uid>/<filename>'. Reads of raw objects are owner-only; everyone else
-- gets approved media via signed URLs minted server-side (no direct read).
do $$ begin
  create policy "p3_media_owner_insert" on storage.objects for insert to authenticated
    with check (
      bucket_id in ('place-photos','ambient-audio')
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "p3_media_owner_read" on storage.objects for select to authenticated
    using (
      bucket_id in ('place-photos','ambient-audio')
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "p3_media_owner_delete" on storage.objects for delete to authenticated
    using (
      bucket_id in ('place-photos','ambient-audio')
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run test, expect PASS** (`supabase db reset && psql … -f supabase/tests/p3_buckets.sql`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130000_p3_storage_buckets.sql supabase/tests/p3_buckets.sql
git commit -m "$(cat <<'EOF'
P3: declare private place-photos + ambient-audio Storage buckets in-migration with owner-scoped RLS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `sounds` — curated ambient-sound library (source + licensing)

**Why:** closes "dead ambient-sound UI + missing source/licensing." A small, **pre-cleared** library every creator can pick from. Each row tracks `source`, `license`, and `attribution` so the UI can display licensing and we never ship audio we can't legally use. These bypass UGC moderation (they're already approved).

**Files:**
- Create: `supabase/migrations/20260526130100_p3_sounds.sql`
- Modify: `supabase/seed.sql` (append seed rows)
- Test: `supabase/tests/p3_sounds.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p3_sounds.sql
DO $$
DECLARE n int;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='sounds' AND column_name='license';
  IF NOT FOUND THEN RAISE EXCEPTION 'sounds.license missing (licensing not tracked)'; END IF;
  -- public read must only expose active rows
  PERFORM 1 FROM pg_policies WHERE tablename='sounds' AND policyname='sounds_public_read';
  IF NOT FOUND THEN RAISE EXCEPTION 'sounds_public_read policy missing'; END IF;
  SELECT count(*) INTO n FROM sounds WHERE is_active;
  IF n < 6 THEN RAISE EXCEPTION 'expected >=6 seeded curated sounds, got %', n; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "sounds" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130100_p3_sounds.sql
create type sound_license as enum ('cc0','cc_by','licensed','original');

create table if not exists sounds (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  -- storage path inside the (public-readable) curated prefix, OR a CDN URL.
  audio_url text not null,
  duration_sec int not null check (duration_sec between 5 and 600),
  vibe_tags text[] not null default '{}',     -- e.g. {romantic,cozy} — used by sounds.ts selection
  source text not null,                        -- provider / artist (e.g. 'freesound: Kvgarlic')
  source_url text,                             -- where it came from, for audit
  license sound_license not null,
  attribution text,                            -- display string when license requires it
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sounds_active_idx on sounds(is_active) where is_active;
create index if not exists sounds_vibe_gin on sounds using gin (vibe_tags);
create trigger set_sounds_updated_at before update on sounds
  for each row execute function set_updated_at();

alter table sounds enable row level security;
do $$ begin
  create policy "sounds_public_read" on sounds for select using (is_active = true);
exception when duplicate_object then null; end $$;
-- writes are service-role/admin only (no insert/update policy = default deny).
```

- [ ] **Step 4: Append the seed** to `supabase/seed.sql` (curated, pre-cleared — real CC0/licensed Okanagan-evening ambiences; `audio_url` points at the public curated CDN/Storage path). Use `on conflict (slug) do nothing` so reseeds are idempotent:

```sql
-- ─── P3 curated ambient-sound library (pre-cleared licensing) ───
insert into sounds (slug, title, audio_url, duration_sec, vibe_tags, source, source_url, license, attribution) values
  ('lakeside-dusk',  'Lakeside Dusk',  'https://cdn.tryafter5.app/sounds/lakeside-dusk.webm',  60, '{romantic,cozy,chill}',        'After5 field recording', null, 'original', null),
  ('patio-evening',  'Patio Evening',  'https://cdn.tryafter5.app/sounds/patio-evening.webm',  60, '{lively,casual,fun}',          'After5 field recording', null, 'original', null),
  ('vineyard-wind',  'Vineyard Wind',  'https://cdn.tryafter5.app/sounds/vineyard-wind.webm',  60, '{romantic,boujee,intimate}',   'After5 field recording', null, 'original', null),
  ('rain-on-window', 'Rain on Window', 'https://cdn.tryafter5.app/sounds/rain-on-window.webm', 60, '{cozy,chill,intimate}',        'Freesound (CC0)', 'https://freesound.org/', 'cc0', null),
  ('cafe-murmur',    'Cafe Murmur',    'https://cdn.tryafter5.app/sounds/cafe-murmur.webm',    60, '{casual,chill,cultural}',      'Freesound (CC0)', 'https://freesound.org/', 'cc0', null),
  ('night-market',   'Night Market',   'https://cdn.tryafter5.app/sounds/night-market.webm',   60, '{adventurous,lively,fun}',     'Freesound (CC-BY)','https://freesound.org/', 'cc_by', 'Sound by contributor, CC-BY 4.0'),
  ('forest-trail',   'Forest Trail',   'https://cdn.tryafter5.app/sounds/forest-trail.webm',   60, '{adventurous,chill}',          'After5 field recording', null, 'original', null)
on conflict (slug) do nothing;
```

- [ ] **Step 5: Apply + run test, expect PASS** (`supabase db reset && psql … -f supabase/tests/p3_sounds.sql`; reset re-runs seed).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260526130100_p3_sounds.sql supabase/seed.sql supabase/tests/p3_sounds.sql
git commit -m "$(cat <<'EOF'
P3: curated ambient-sound library (sounds table + license tracking + seed)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `media_assets` — UGC + generated media with moderation state (P8 ingestion point)

**Why:** closes "no media pipeline" + "UGC ingestion point for moderation." Every uploaded place photo or ambient-audio clip gets a row here. `moderation_state` starts `pending`; only `approved` assets may be referenced by an itinerary/place. This table is the queue P8's moderation console reads.

**Files:**
- Create: `supabase/migrations/20260526130200_p3_media_assets.sql`
- Test: `supabase/tests/p3_media_assets.sql`

- [ ] **Step 1: Write the failing test** (default state is `pending`; owner can read own; transition trigger audits)

```sql
-- supabase/tests/p3_media_assets.sql
DO $$
DECLARE owner uuid; mid uuid; st text; n int;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'owner') returning id into owner;
  insert into media_assets (owner_id, bucket_id, object_path, kind)
    values (owner, 'place-photos', owner::text || '/photo1.jpg', 'place_photo')
    returning id, moderation_state::text into mid, st;
  IF st <> 'pending' THEN RAISE EXCEPTION 'media default state must be pending, got %', st; END IF;
  -- a moderation transition writes an audit row (reuses P0 log_status_transition)
  update media_assets set moderation_state='approved' where id=mid;
  select count(*) into n from audit_log where entity='media_assets' and entity_id=mid;
  IF n < 1 THEN RAISE EXCEPTION 'media_assets moderation transition not audited'; END IF;
  RAISE NOTICE 'media_assets OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "media_assets" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130200_p3_media_assets.sql
create type media_kind as enum ('place_photo','ambient_audio');
create type media_processing_state as enum ('uploaded','processing','processed','failed');
create type media_moderation_state as enum ('pending','approved','rejected','flagged');

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  bucket_id text not null check (bucket_id in ('place-photos','ambient-audio')),
  object_path text not null,                 -- '<uid>/<file>' in the bucket
  kind media_kind not null,
  -- where the processed (transcoded/CDN) artifact lives once process-media runs
  processed_path text,
  cdn_url text,
  width int, height int, duration_sec int,   -- populated by process-media
  processing_state media_processing_state not null default 'uploaded',
  -- 'status' alias so P0's generic log_status_transition() (which reads NEW.status)
  -- captures moderation changes in audit_log. We trigger on moderation_state below.
  moderation_state media_moderation_state not null default 'pending',
  moderation_reason text,
  -- optional linkage; set once approved + attached
  place_id uuid references places(id) on delete set null,
  itinerary_id uuid references itineraries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);
create index if not exists media_assets_owner_idx on media_assets(owner_id);
create index if not exists media_assets_moderation_idx on media_assets(moderation_state)
  where moderation_state in ('pending','flagged');   -- the P8 queue
create trigger set_media_assets_updated_at before update on media_assets
  for each row execute function set_updated_at();

-- Audit moderation transitions. P0's log_status_transition() reads NEW.status,
-- so use a small dedicated trigger fn that maps moderation_state → audit_log.
create or replace function log_media_moderation() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if (tg_op='INSERT') then
    insert into audit_log(entity,entity_id,action,new_status,actor)
    values ('media_assets', new.id, 'insert', new.moderation_state::text, auth.uid());
  elsif (tg_op='UPDATE' and new.moderation_state is distinct from old.moderation_state) then
    insert into audit_log(entity,entity_id,action,old_status,new_status,actor)
    values ('media_assets', new.id, 'moderation_change',
            old.moderation_state::text, new.moderation_state::text, auth.uid());
  end if;
  return new;
end $fn$;
create trigger audit_media_assets after insert or update on media_assets
  for each row execute function log_media_moderation();

alter table media_assets enable row level security;
do $$ begin
  -- owner can create + read + delete their own uploads (pre-moderation)
  create policy "media_assets_owner_all" on media_assets for all
    using (owner_id = auth.uid()) with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;
-- moderation review/write (approve/reject) is service-role/admin only (P8);
-- the owner_all policy intentionally does NOT let owners self-approve because
-- moderation_state flips are performed via service-role in process-media / P8.
```

> **Self-approval note:** the `owner_all` policy *technically* lets an owner UPDATE their own row including `moderation_state`. P0/P8 enforce that only **service-role** flips `moderation_state` to `approved`; to make that structural here, add a column-guard: a `BEFORE UPDATE` trigger that raises if a non-service-role session changes `moderation_state` to anything but `pending`/`rejected`-by-self. Implement that guard in this migration:

```sql
create or replace function guard_media_self_approval() returns trigger
language plpgsql as $fn$
begin
  if (new.moderation_state is distinct from old.moderation_state)
     and new.moderation_state in ('approved','flagged')
     and auth.uid() is not null then   -- a real user session, not service-role
    raise exception 'users cannot self-approve media';
  end if;
  return new;
end $fn$;
create trigger media_guard_self_approval before update on media_assets
  for each row execute function guard_media_self_approval();
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `media_assets OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130200_p3_media_assets.sql supabase/tests/p3_media_assets.sql
git commit -m "$(cat <<'EOF'
P3: media_assets (UGC photo/audio) with moderation state, audit trigger, self-approval guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `itineraries.opener` + personalization marker

**Why:** P0 added `pay_setting`, `ambient_sound_url`, `why_note`, `is_evergreen`. The spec §4 also lists an **opener** (the conversation-starter line) as a date field; it's not yet a column. Add it plus a `sound_id` FK (so a curated library pick is tracked, not just a free URL) and a `personalized_at` marker (distinguishes a raw generator first-draft from a creator-edited evergreen idea — used by browse/quality later).

**Files:**
- Create: `supabase/migrations/20260526130300_p3_itineraries_opener.sql`
- Test: `supabase/tests/p3_itineraries_opener.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p3_itineraries_opener.sql
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns WHERE table_name='itineraries' AND column_name='opener';
  IF NOT FOUND THEN RAISE EXCEPTION 'itineraries.opener missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='itineraries' AND column_name='sound_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'itineraries.sound_id missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='itineraries' AND column_name='personalized_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'itineraries.personalized_at missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130300_p3_itineraries_opener.sql
alter table itineraries
  add column if not exists opener text,                       -- creator's conversation-starter line
  add column if not exists sound_id uuid references sounds(id) on delete set null,
  -- when a creator first personalizes the generator's first draft into an evergreen idea
  add column if not exists personalized_at timestamptz;

-- Keep ambient_sound_url (P0) authoritative for the *resolved* audio URL, but
-- backfill it from a chosen library sound when sound_id is set and url is null.
create or replace function sync_itinerary_sound() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if (new.sound_id is not null) then
    select audio_url into new.ambient_sound_url from sounds where id = new.sound_id and is_active;
  end if;
  return new;
end $fn$;
create trigger itineraries_sync_sound before insert or update of sound_id on itineraries
  for each row execute function sync_itinerary_sound();
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130300_p3_itineraries_opener.sql supabase/tests/p3_itineraries_opener.sql
git commit -m "$(cat <<'EOF'
P3: itineraries opener + sound_id (curated lib link) + personalized_at marker

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `availability_windows` — recollected availability (the conversion join)

**Why:** the core fix for "I liked the idea but not that time." An **evergreen idea has no time**; when a creator decides to act, they declare *fresh* availability windows. A `date_instance` can only be created for a `starts_at` that falls **inside a current window**. This table is the source of truth for that re-collection, keyed to the itinerary + creator.

**Files:**
- Create: `supabase/migrations/20260526130400_p3_availability_windows.sql`
- Test: `supabase/tests/p3_availability_windows.sql`

- [ ] **Step 1: Write the failing test** (a window is a `tstzrange`; only the owning creator can read/write; no overlapping windows for the same itinerary)

```sql
-- supabase/tests/p3_availability_windows.sql
DO $$
DECLARE cre uuid; cid uuid; it uuid; w1 uuid; ok boolean := false;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'cre') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p3w','p3w','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p3w';
  insert into itineraries (id,user_id,city_id) values (gen_random_uuid(),cre,cid) returning id into it;
  insert into availability_windows (itinerary_id, creator_id, window)
    values (it, cre, tstzrange(timestamptz '2026-06-10 18:00Z', timestamptz '2026-06-10 23:00Z'))
    returning id into w1;
  BEGIN
    insert into availability_windows (itinerary_id, creator_id, window)
      values (it, cre, tstzrange(timestamptz '2026-06-10 20:00Z', timestamptz '2026-06-11 01:00Z')); -- overlaps
  EXCEPTION WHEN exclusion_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'overlapping availability windows allowed for one itinerary'; END IF;
  RAISE NOTICE 'availability_windows OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "availability_windows" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130400_p3_availability_windows.sql
create table if not exists availability_windows (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references itineraries(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  window tstzrange not null,
  -- staleness: windows older than this are ignored by the conversion RPC.
  collected_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a window must be non-empty and start in the future at collection time
  check (not isempty(window) and lower(window) > collected_at - interval '1 minute'),
  -- no two ACTIVE windows for the same itinerary may overlap
  exclude using gist (itinerary_id with =, window with &&) where (is_active)
);
create index if not exists availability_windows_itin_idx on availability_windows(itinerary_id) where is_active;
create trigger set_availability_windows_updated_at before update on availability_windows
  for each row execute function set_updated_at();

alter table availability_windows enable row level security;
do $$ begin
  create policy "availability_windows_creator_all" on availability_windows for all
    using (creator_id = auth.uid()) with check (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
```

> **Note:** `availability_windows` requires `btree_gist` (already installed by P0 Task 1) for the GiST exclusion over `(uuid =, tstzrange &&)`.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `availability_windows OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130400_p3_availability_windows.sql supabase/tests/p3_availability_windows.sql
git commit -m "$(cat <<'EOF'
P3: availability_windows (recollected availability) with no-overlap GiST exclusion + future-only check

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: evergreen→scheduled conversion guard (shared TS logic)

**Why:** the conversion rule is product logic the web + native clients must share. It is a pure function: given a chosen `starts_at`/`duration_min` and the creator's current windows, decide if a `date_instance` may be created. Tested with vitest. The DB RPC (Task 7) calls the same rule, but encoding it in shared TS lets the client pre-validate and give a clean error before round-tripping.

**Files:**
- Create: `packages/business/src/conversion.ts`
- Create: `packages/business/src/conversion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/conversion.test.ts
import { describe, it, expect } from 'vitest';
import { canSchedule, type Window } from './conversion';

const now = new Date('2026-06-01T00:00:00Z');
const windows: Window[] = [
  { lower: '2026-06-10T18:00:00Z', upper: '2026-06-10T23:00:00Z' },
];

describe('canSchedule (evergreen → scheduled)', () => {
  it('rejects when no availability windows were re-collected', () => {
    const r = canSchedule({ startsAt: '2026-06-10T19:00:00Z', durationMin: 120, windows: [], now });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_availability');   // forces re-collection
  });
  it('rejects a start time that falls outside every window', () => {
    const r = canSchedule({ startsAt: '2026-06-11T19:00:00Z', durationMin: 120, windows, now });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('outside_window');     // "liked the idea, not that time"
  });
  it('rejects when the instance would run past the window end', () => {
    const r = canSchedule({ startsAt: '2026-06-10T22:30:00Z', durationMin: 120, windows, now });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exceeds_window');
  });
  it('rejects a start time in the past', () => {
    const r = canSchedule({ startsAt: '2026-05-01T19:00:00Z', durationMin: 120, windows, now });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('in_past');
  });
  it('accepts a start fully inside a window in the future', () => {
    const r = canSchedule({ startsAt: '2026-06-10T19:00:00Z', durationMin: 120, windows, now });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm --filter @after5/business test` → cannot find `./conversion`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/business/src/conversion.ts
export interface Window { lower: string; upper: string; } // ISO tstzrange bounds
export interface ScheduleInput {
  startsAt: string; durationMin: number; windows: Window[]; now: Date;
}
export type ScheduleReason =
  | 'no_availability' | 'in_past' | 'outside_window' | 'exceeds_window';
export type ScheduleResult = { ok: true } | { ok: false; reason: ScheduleReason };

export function canSchedule(i: ScheduleInput): ScheduleResult {
  if (i.windows.length === 0) return { ok: false, reason: 'no_availability' };
  const start = new Date(i.startsAt).getTime();
  const end = start + i.durationMin * 60_000;
  if (start <= i.now.getTime()) return { ok: false, reason: 'in_past' };
  const containing = i.windows.find(w => {
    const lo = new Date(w.lower).getTime(), hi = new Date(w.upper).getTime();
    return start >= lo && start < hi;
  });
  if (!containing) return { ok: false, reason: 'outside_window' };
  if (end > new Date(containing.upper).getTime()) return { ok: false, reason: 'exceeds_window' };
  return { ok: true };
}
```

- [ ] **Step 4: Run it, expect PASS** (5 passing).

- [ ] **Step 5: Export from package index** — add `export * from './conversion';` to `packages/business/src/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/conversion.ts packages/business/src/conversion.test.ts packages/business/src/index.ts
git commit -m "$(cat <<'EOF'
P3: shared evergreen→scheduled conversion guard (re-collected availability required)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `convert_to_scheduled` RPC — server-enforced conversion (re-collects availability)

**Why:** the client guard (Task 6) is UX; the **database** must enforce that a `date_instance` is only created against a fresh, containing window. A SECURITY DEFINER function: takes `itinerary_id`, `venue_id`, `starts_at`, `duration_min`; verifies caller owns the itinerary, that an **active, non-stale** window contains the full instance, then inserts the `date_instance` and audits it. Mirrors the spec's "convert before any offer/reveal" rule.

**Files:**
- Create: `supabase/migrations/20260526130500_p3_convert_rpc.sql`
- Test: `supabase/tests/p3_convert_rpc.sql`

- [ ] **Step 1: Write the failing test** (no window → reject; containing window → instance created + audited)

```sql
-- supabase/tests/p3_convert_rpc.sql
DO $$
DECLARE cre uuid; cid uuid; it uuid; inst uuid; got_err boolean := false; n int;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'cre') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p3c','p3c','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p3c';
  insert into itineraries (id,user_id,city_id,is_evergreen) values (gen_random_uuid(),cre,cid,true)
    returning id into it;

  -- (a) no availability window → conversion must fail
  BEGIN
    perform convert_to_scheduled(it, null, timestamptz '2026-06-10 19:00Z', 120, cre);
  EXCEPTION WHEN others THEN got_err := true;
  END;
  IF NOT got_err THEN RAISE EXCEPTION 'conversion succeeded with no availability window'; END IF;

  -- (b) with a containing window → conversion succeeds
  insert into availability_windows (itinerary_id, creator_id, window)
    values (it, cre, tstzrange(timestamptz '2026-06-10 18:00Z', timestamptz '2026-06-10 23:00Z'));
  select convert_to_scheduled(it, null, timestamptz '2026-06-10 19:00Z', 120, cre) into inst;
  IF inst IS NULL THEN RAISE EXCEPTION 'conversion returned null instance'; END IF;
  PERFORM 1 FROM date_instances WHERE id=inst AND creator_id=cre AND status='seeking';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instance not created in seeking state'; END IF;
  select count(*) into n from audit_log where entity='date_instances' and entity_id=inst;
  IF n < 1 THEN RAISE EXCEPTION 'conversion not audited'; END IF;

  -- (c) start outside window → fail
  got_err := false;
  BEGIN
    perform convert_to_scheduled(it, null, timestamptz '2026-06-11 19:00Z', 120, cre);
  EXCEPTION WHEN others THEN got_err := true;
  END;
  IF NOT got_err THEN RAISE EXCEPTION 'conversion succeeded outside availability window'; END IF;

  RAISE NOTICE 'convert_to_scheduled OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function convert_to_scheduled(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130500_p3_convert_rpc.sql
-- Evergreen → scheduled conversion. Enforces, in the DB, that a fresh, active,
-- non-stale availability window CONTAINS the whole instance. p_actor lets tests
-- pass a creator id; in production callers pass auth.uid() (the function also
-- verifies p_actor owns the itinerary).
create or replace function convert_to_scheduled(
  p_itinerary_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_duration_min int,
  p_actor uuid default auth.uid()
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_city uuid;
  v_inst uuid;
  v_range tstzrange := tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_min));
  v_stale interval := interval '14 days';   -- windows older than this don't count
begin
  -- ownership + city
  select city_id into v_city from itineraries
   where id = p_itinerary_id and user_id = p_actor;
  if v_city is null then
    raise exception 'not_owner_or_missing_city';
  end if;

  if p_starts_at <= now() then
    raise exception 'in_past';
  end if;

  -- a current, active window must FULLY CONTAIN the instance range
  perform 1 from availability_windows
   where itinerary_id = p_itinerary_id
     and creator_id = p_actor
     and is_active
     and collected_at > now() - v_stale
     and window @> v_range;
  if not found then
    raise exception 'no_containing_window';   -- forces (re)collection at conversion
  end if;

  insert into date_instances (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status)
  values (p_itinerary_id, p_actor, v_city, p_venue_id, p_starts_at, p_duration_min, 'seeking')
  returning id into v_inst;

  return v_inst;
end $fn$;

revoke all on function convert_to_scheduled(uuid,uuid,timestamptz,int,uuid) from public;
grant execute on function convert_to_scheduled(uuid,uuid,timestamptz,int,uuid) to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `convert_to_scheduled OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130500_p3_convert_rpc.sql supabase/tests/p3_convert_rpc.sql
git commit -m "$(cat <<'EOF'
P3: convert_to_scheduled RPC — DB-enforced evergreen→scheduled requiring a containing fresh availability window

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `attach_media` RPC — only approved media may be referenced

**Why:** closes the moderation loop on the write side. A creator can only set `itineraries.ambient_sound_url`/place photo from media that is **approved** (UGC) or from the curated `sounds` library (pre-cleared). This RPC is the single sanctioned path; direct column writes to `ambient_sound_url` from arbitrary UGC are blocked because the source asset must be checked.

**Files:**
- Create: `supabase/migrations/20260526130600_p3_attach_media_rpc.sql`
- Test: `supabase/tests/p3_attach_media.sql`

- [ ] **Step 1: Write the failing test** (pending media rejected; approved media attaches; curated sound attaches)

```sql
-- supabase/tests/p3_attach_media.sql
DO $$
DECLARE cre uuid; cid uuid; it uuid; m uuid; got_err boolean := false; got_url text; sid uuid;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'cre') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p3m','p3m','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p3m';
  insert into itineraries (id,user_id,city_id) values (gen_random_uuid(),cre,cid) returning id into it;

  -- pending audio asset → attach must reject
  insert into media_assets (owner_id,bucket_id,object_path,kind,cdn_url,processing_state)
    values (cre,'ambient-audio',cre::text||'/a.webm','ambient_audio','https://cdn/x.webm','processed')
    returning id into m;
  BEGIN
    perform attach_ambient_media(it, m, cre);
  EXCEPTION WHEN others THEN got_err := true; END;
  IF NOT got_err THEN RAISE EXCEPTION 'attached pending (unmoderated) media'; END IF;

  -- approve it (service-role path) → attach succeeds and sets ambient_sound_url
  update media_assets set moderation_state='approved' where id=m;  -- (test has no auth.uid → allowed)
  perform attach_ambient_media(it, m, cre);
  select ambient_sound_url into got_url from itineraries where id=it;
  IF got_url IS DISTINCT FROM 'https://cdn/x.webm' THEN
    RAISE EXCEPTION 'approved media not attached, url=%', got_url; END IF;

  -- curated library sound also attaches (pre-cleared)
  select id into sid from sounds where is_active limit 1;
  IF sid IS NOT NULL THEN
    perform attach_library_sound(it, sid, cre);
    select ambient_sound_url into got_url from itineraries where id=it;
    IF got_url IS NULL THEN RAISE EXCEPTION 'library sound not attached'; END IF;
  END IF;

  RAISE NOTICE 'attach_media OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function attach_ambient_media(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130600_p3_attach_media_rpc.sql
-- Attach an APPROVED UGC ambient-audio asset to an itinerary the caller owns.
create or replace function attach_ambient_media(
  p_itinerary_id uuid, p_media_id uuid, p_actor uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_url text; v_state media_moderation_state; v_kind media_kind;
begin
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  select coalesce(cdn_url, '') , moderation_state, kind
    into v_url, v_state, v_kind
    from media_assets where id=p_media_id and owner_id=p_actor;
  if not found then raise exception 'media_not_found'; end if;
  if v_kind <> 'ambient_audio' then raise exception 'wrong_media_kind'; end if;
  if v_state <> 'approved' then raise exception 'media_not_approved'; end if;
  if v_url = '' then raise exception 'media_not_processed'; end if;
  update itineraries
     set ambient_sound_url = v_url, sound_id = null,
         personalized_at = coalesce(personalized_at, now())
   where id = p_itinerary_id;
end $fn$;

-- Attach a curated library sound (pre-cleared, no moderation needed).
create or replace function attach_library_sound(
  p_itinerary_id uuid, p_sound_id uuid, p_actor uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  perform 1 from sounds where id=p_sound_id and is_active;
  if not found then raise exception 'sound_not_found'; end if;
  -- itineraries_sync_sound trigger resolves ambient_sound_url from sound_id
  update itineraries
     set sound_id = p_sound_id, personalized_at = coalesce(personalized_at, now())
   where id = p_itinerary_id;
end $fn$;

revoke all on function attach_ambient_media(uuid,uuid,uuid) from public;
revoke all on function attach_library_sound(uuid,uuid,uuid) from public;
grant execute on function attach_ambient_media(uuid,uuid,uuid) to authenticated;
grant execute on function attach_library_sound(uuid,uuid,uuid) to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `attach_media OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130600_p3_attach_media_rpc.sql supabase/tests/p3_attach_media.sql
git commit -m "$(cat <<'EOF'
P3: attach_ambient_media / attach_library_sound RPCs — only approved UGC or curated sounds attach

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `sounds.ts` — curated-library selection + license display (shared TS)

**Why:** the creation UI offers a default ambient sound matched to the idea's vibe and shows licensing/attribution. Pure logic → vitest. Both web and native consume it via `@after5/business`.

**Files:**
- Create: `packages/business/src/sounds.ts`
- Create: `packages/business/src/sounds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/sounds.test.ts
import { describe, it, expect } from 'vitest';
import { suggestSound, licenseLabel, type SoundRow } from './sounds';

const lib: SoundRow[] = [
  { id: '1', slug: 'lakeside-dusk', title: 'Lakeside Dusk', vibe_tags: ['romantic','cozy'], license: 'original', attribution: null },
  { id: '2', slug: 'night-market',  title: 'Night Market',  vibe_tags: ['adventurous','lively'], license: 'cc_by', attribution: 'Sound by X, CC-BY 4.0' },
  { id: '3', slug: 'cafe-murmur',   title: 'Cafe Murmur',   vibe_tags: ['casual','chill'], license: 'cc0', attribution: null },
];

describe('suggestSound', () => {
  it('picks the highest vibe-tag overlap', () => {
    expect(suggestSound(lib, ['romantic','cozy'])!.slug).toBe('lakeside-dusk');
  });
  it('falls back to the first active sound when no vibe overlaps', () => {
    expect(suggestSound(lib, ['boujee'])!.slug).toBe('lakeside-dusk');
  });
  it('returns null for an empty library', () => {
    expect(suggestSound([], ['romantic'])).toBeNull();
  });
});

describe('licenseLabel', () => {
  it('shows attribution when the license requires it', () => {
    expect(licenseLabel(lib[1])).toContain('CC-BY');
  });
  it('marks CC0 as no attribution required', () => {
    expect(licenseLabel(lib[2])).toMatch(/no attribution/i);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (cannot find `./sounds`).

- [ ] **Step 3: Write the implementation**

```ts
// packages/business/src/sounds.ts
export type SoundLicense = 'cc0' | 'cc_by' | 'licensed' | 'original';
export interface SoundRow {
  id: string; slug: string; title: string;
  vibe_tags: string[]; license: SoundLicense; attribution: string | null;
}

export function suggestSound(lib: SoundRow[], vibe: string[]): SoundRow | null {
  if (lib.length === 0) return null;
  const wanted = new Set(vibe);
  let best = lib[0], bestScore = -1;
  for (const s of lib) {
    const score = s.vibe_tags.reduce((n, t) => n + (wanted.has(t) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

export function licenseLabel(s: SoundRow): string {
  switch (s.license) {
    case 'cc0':       return 'CC0 — no attribution required';
    case 'cc_by':     return s.attribution ?? 'CC-BY — attribution required';
    case 'licensed':  return 'Licensed for After5';
    case 'original':  return 'Original After5 recording';
  }
}
```

- [ ] **Step 4: Run it, expect PASS** (5 passing).

- [ ] **Step 5: Export** — add `export * from './sounds';` to `packages/business/src/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/sounds.ts packages/business/src/sounds.test.ts packages/business/src/index.ts
git commit -m "$(cat <<'EOF'
P3: shared sounds selection + license-label helpers for the curated ambient library

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `process-media` Edge Function — transcode/normalize + enqueue moderation

**Why:** closes "no media pipeline." After a client uploads to the private bucket and inserts a `media_assets` row (`processing_state='uploaded'`), this service-role function: downloads the raw object, transcodes images to web-optimized **webp** (reusing the Storage upload pattern from `generate-cover`) and clips/normalizes audio to ≤60s, writes the processed artifact + `cdn_url`, sets `processing_state='processed'`, and **leaves `moderation_state='pending'`** so P8 can action it. The function is the UGC ingestion → moderation handoff.

**Files:**
- Create: `supabase/functions/_shared/media.ts`
- Create: `supabase/functions/process-media/index.ts`
- Create: `supabase/functions/process-media/process_media_test.ts`
- Modify: `supabase/config.toml` (add `[functions.process-media] verify_jwt = false` — authenticated manually via service-role bearer, matching `generate-cover`/`classify-photos`)

- [ ] **Step 1: Write the failing test** (pure-logic units: path derivation + audio clip-length policy; no network)

```ts
// supabase/functions/process-media/process_media_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { processedPathFor, clampAudioDuration, MAX_AUDIO_SEC } from '../_shared/media.ts';

Deno.test('processedPathFor turns an upload path into a processed webp path', () => {
  assertEquals(
    processedPathFor('place-photos', 'uid-123/raw.heic', 'webp'),
    'processed/uid-123/raw.webp',
  );
});

Deno.test('processedPathFor keeps audio extension', () => {
  assertEquals(
    processedPathFor('ambient-audio', 'uid-9/clip.wav', 'webm'),
    'processed/uid-9/clip.webm',
  );
});

Deno.test('clampAudioDuration caps at MAX_AUDIO_SEC', () => {
  assertEquals(clampAudioDuration(180), MAX_AUDIO_SEC);
  assertEquals(clampAudioDuration(30), 30);
  assertEquals(clampAudioDuration(0), 0);
});
```

- [ ] **Step 2: Run it, expect FAIL** — `deno test supabase/functions/process-media/process_media_test.ts` → cannot find `../_shared/media.ts`.

- [ ] **Step 3: Write `_shared/media.ts`** (pure helpers + the I/O helpers used by index.ts)

```ts
// supabase/functions/_shared/media.ts
export const MAX_AUDIO_SEC = 60;

/** Derive the processed-artifact object path from a raw upload path. */
export function processedPathFor(_bucket: string, rawPath: string, ext: 'webp' | 'webm'): string {
  const noExt = rawPath.replace(/\.[^/.]+$/, '');
  return `processed/${noExt}.${ext}`;
}

export function clampAudioDuration(sec: number): number {
  return Math.min(Math.max(0, sec), MAX_AUDIO_SEC);
}
```

> The actual transcode (image → webp, audio → normalized webm clip) in `index.ts` uses Supabase Storage's image transformation for photos (the platform feature `generate-cover` relies on) and an audio re-encode via the same upload-bytes pattern (`supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert:true })`) seen in `generate-cover/index.ts:240-264`. Keep all *pure* derivations in `_shared/media.ts` so they're unit-testable without network.

- [ ] **Step 4: Write `process-media/index.ts`** following the `generate-cover` shape exactly:
  - Service-role bearer check (`Authorization === 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY`), CORS preflight, JSON body `{ media_id?: string; batch_size?: number }`.
  - Resolve target `media_assets` rows where `processing_state='uploaded'` (or a single `media_id`).
  - For each: set `processing_state='processing'`; download raw object from its bucket; transcode (webp for `place_photo`, normalized ≤`MAX_AUDIO_SEC` clip for `ambient_audio`); upload the processed artifact to `processedPathFor(...)`; mint a signed/public CDN URL; `update media_assets set processed_path, cdn_url, width/height/duration_sec, processing_state='processed'` (moderation_state stays `pending`).
  - On error set `processing_state='failed'` and continue (mirror `generate-cover`'s per-row error collection).
  - Return `{ processed: n, results: [...] }`.

- [ ] **Step 5: Add config** to `supabase/config.toml`:

```toml
[functions.process-media]
verify_jwt = false
```

- [ ] **Step 6: Run the test, expect PASS** — `deno test supabase/functions/process-media/process_media_test.ts` (3 passing).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/media.ts supabase/functions/process-media/index.ts supabase/functions/process-media/process_media_test.ts supabase/config.toml
git commit -m "$(cat <<'EOF'
P3: process-media Edge Function — transcode/normalize uploads to CDN, leave moderation pending (P8 handoff)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Integrate the generator as the evergreen "first draft"

**Why:** the spec's "AI sets the floor; the human sets the ceiling" — the existing `generate-plan` produces the itinerary; P3 marks generator output as an **evergreen first draft** so the creation UI can offer "personalize this into a date idea." The generator already writes `itineraries` rows; P3 makes those rows dating-ready by setting the new dating fields at insert time and tagging them `is_evergreen=true`, `personalized_at=null`. **No change to the LLM/scoring path** — only the persistence shape.

**Files:**
- Modify: `supabase/functions/generate-plan/index.ts` (the `insertRows` map, ~line 506–542)
- Create: `supabase/functions/generate-plan/dating_fields_test.ts`

- [ ] **Step 1: Write the failing test** (pure helper that builds the dating columns from inputs)

```ts
// supabase/functions/generate-plan/dating_fields_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { datingFieldsForInsert } from './dating-fields.ts';

Deno.test('generator output is an evergreen, un-personalized first draft', () => {
  const f = datingFieldsForInsert({ vibe: ['romantic'], note: 'anniversary' });
  assertEquals(f.is_evergreen, true);
  assertEquals(f.personalized_at, null);     // not yet creator-edited
  assertEquals(f.match_status, 'none');      // not seeking until scheduled
  assertEquals(f.why_note, 'anniversary');   // seeds the "why" from the note
  assertEquals(f.opener, null);              // creator writes this during personalization
  assertEquals(f.pay_setting, null);         // creator chooses during personalization
});
```

- [ ] **Step 2: Run it, expect FAIL** (cannot find `./dating-fields.ts`).

- [ ] **Step 3: Write the helper** `supabase/functions/generate-plan/dating-fields.ts`:

```ts
// Maps generator inputs → the P0/P3 dating columns for an evergreen first draft.
export interface DatingInsertFields {
  is_evergreen: true;
  personalized_at: null;
  match_status: 'none';
  why_note: string | null;
  opener: null;
  pay_setting: null;
}
export function datingFieldsForInsert(inputs: { vibe?: string[]; note?: string }): DatingInsertFields {
  return {
    is_evergreen: true,
    personalized_at: null,
    match_status: 'none',
    why_note: inputs.note?.trim() ? inputs.note.trim() : null,
    opener: null,
    pay_setting: null,
  };
}
```

- [ ] **Step 4: Wire it into `index.ts`** — import `datingFieldsForInsert`, spread its result into each object in `insertRows` (Task references `index.ts:506`). The generator continues to set `is_public`, `stops`, `title`, etc.; the new fields ride alongside. (Columns `city_id`/`ambient_sound_url` stay null at generation — the creator sets them during personalization in Task 12's flow.)

- [ ] **Step 5: Run the test, expect PASS** (1 passing). Then `deno check supabase/functions/generate-plan/index.ts` to confirm it compiles.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-plan/dating-fields.ts supabase/functions/generate-plan/dating_fields_test.ts supabase/functions/generate-plan/index.ts
git commit -m "$(cat <<'EOF'
P3: tag generate-plan output as evergreen first-draft (dating fields at insert, no LLM-path change)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `personalize_itinerary` RPC — venue swap, vibe, "why", opener, pay setting

**Why:** the courtship layer. A creator turns the generator's first draft into *their* date idea: swap a venue (from the vetted DB only — Invariant 5 holds), set vibe tags, the "why" note, the opener, and the pay setting. One owner-guarded RPC writes these and stamps `personalized_at`. Venue swaps validate the new place exists, is active, and is in the same city (no LLM, no fiction).

**Files:**
- Create: `supabase/migrations/20260526130700_p3_personalize_rpc.sql`
- Test: `supabase/tests/p3_personalize.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p3_personalize.sql
DO $$
DECLARE cre uuid; cid uuid; it uuid; got_pay text; got_open text; got_when timestamptz;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'cre') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p3p','p3p','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p3p';
  insert into itineraries (id,user_id,city_id) values (gen_random_uuid(),cre,cid) returning id into it;

  perform personalize_itinerary(
    p_itinerary_id => it,
    p_vibe_tags    => array['romantic','cozy'],
    p_why_note     => 'because the lake at dusk',
    p_opener       => 'What is your go-to comfort movie?',
    p_pay_setting  => 'i_pay',
    p_actor        => cre
  );
  select pay_setting::text, opener, personalized_at
    into got_pay, got_open, got_when from itineraries where id=it;
  IF got_pay <> 'i_pay' THEN RAISE EXCEPTION 'pay_setting not saved'; END IF;
  IF got_open IS NULL THEN RAISE EXCEPTION 'opener not saved'; END IF;
  IF got_when IS NULL THEN RAISE EXCEPTION 'personalized_at not stamped'; END IF;
  RAISE NOTICE 'personalize_itinerary OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function personalize_itinerary(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130700_p3_personalize_rpc.sql
create or replace function personalize_itinerary(
  p_itinerary_id uuid,
  p_vibe_tags text[] default null,
  p_why_note text default null,
  p_opener text default null,
  p_pay_setting payment_preference default null,
  p_actor uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  update itineraries set
    vibe_tags       = coalesce(p_vibe_tags, vibe_tags),
    why_note        = coalesce(nullif(btrim(p_why_note), ''), why_note),
    opener          = coalesce(nullif(btrim(p_opener), ''), opener),
    pay_setting     = coalesce(p_pay_setting, pay_setting),
    personalized_at = now()
  where id = p_itinerary_id;
end $fn$;

-- Venue swap is separate so it can validate the target place (vetted DB only).
create or replace function swap_itinerary_venue(
  p_itinerary_id uuid, p_stop_index int, p_new_place_id uuid, p_actor uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_city uuid; v_place_active boolean; v_stops jsonb;
begin
  select city_id, stops into v_city, v_stops from itineraries
   where id=p_itinerary_id and user_id=p_actor;
  if v_city is null then raise exception 'not_owner'; end if;
  -- vetted DB only: place must exist + be active. (Same-city check left soft
  -- because places.city_id is added in a later phase; enforce existence now.)
  select is_active into v_place_active from places where id=p_new_place_id;
  if v_place_active is distinct from true then raise exception 'place_not_available'; end if;
  if p_stop_index < 0 or p_stop_index >= jsonb_array_length(v_stops) then
    raise exception 'bad_stop_index';
  end if;
  -- rewrite that stop's place_id; full stop re-hydration (name/photo) happens
  -- client-side from places on next read. Keep the swap minimal + auditable.
  update itineraries
     set stops = jsonb_set(v_stops, array[p_stop_index::text, 'place_id'], to_jsonb(p_new_place_id::text)),
         personalized_at = now()
   where id = p_itinerary_id;
end $fn$;

revoke all on function personalize_itinerary(uuid,text[],text,text,payment_preference,uuid) from public;
revoke all on function swap_itinerary_venue(uuid,int,uuid,uuid) from public;
grant execute on function personalize_itinerary(uuid,text[],text,text,payment_preference,uuid) to authenticated;
grant execute on function swap_itinerary_venue(uuid,int,uuid,uuid) to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `personalize_itinerary OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130700_p3_personalize_rpc.sql supabase/tests/p3_personalize.sql
git commit -m "$(cat <<'EOF'
P3: personalize_itinerary + swap_itinerary_venue RPCs (vibe/why/opener/pay + vetted-DB venue swap)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `availability.ts` — window validation (shared TS)

**Why:** the re-collection UI (when converting evergreen→scheduled) needs to validate proposed windows before inserting them (no past windows, min lead time, well-formed range). Pure logic → vitest; the DB `availability_windows` CHECK is the backstop, this is the friendly client-side guard.

**Files:**
- Create: `packages/business/src/availability.ts`
- Create: `packages/business/src/availability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/availability.test.ts
import { describe, it, expect } from 'vitest';
import { validateWindow } from './availability';

const now = new Date('2026-06-01T12:00:00Z');

describe('validateWindow', () => {
  it('rejects an end before start', () => {
    expect(validateWindow({ lower: '2026-06-10T20:00Z', upper: '2026-06-10T18:00Z', now }).ok).toBe(false);
  });
  it('rejects a window starting in the past', () => {
    expect(validateWindow({ lower: '2026-05-30T18:00Z', upper: '2026-05-30T22:00Z', now }).ok).toBe(false);
  });
  it('rejects a window inside the minimum lead time (default 2h)', () => {
    expect(validateWindow({ lower: '2026-06-01T13:00Z', upper: '2026-06-01T15:00Z', now }).ok).toBe(false);
  });
  it('accepts a valid future window', () => {
    expect(validateWindow({ lower: '2026-06-10T18:00Z', upper: '2026-06-10T23:00Z', now }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (cannot find `./availability`).

- [ ] **Step 3: Write the implementation**

```ts
// packages/business/src/availability.ts
export interface WindowInput { lower: string; upper: string; now: Date; minLeadMin?: number; }
export type WindowResult = { ok: true } | { ok: false; reason: 'bad_range' | 'in_past' | 'too_soon' };

export function validateWindow(i: WindowInput): WindowResult {
  const lo = new Date(i.lower).getTime(), hi = new Date(i.upper).getTime();
  if (!(hi > lo)) return { ok: false, reason: 'bad_range' };
  if (lo <= i.now.getTime()) return { ok: false, reason: 'in_past' };
  const lead = (i.minLeadMin ?? 120) * 60_000;
  if (lo - i.now.getTime() < lead) return { ok: false, reason: 'too_soon' };
  return { ok: true };
}
```

- [ ] **Step 4: Run it, expect PASS** (4 passing).

- [ ] **Step 5: Export** — add `export * from './availability';` to `packages/business/src/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/availability.ts packages/business/src/availability.test.ts packages/business/src/index.ts
git commit -m "$(cat <<'EOF'
P3: shared availability-window validation (no past windows, min lead time)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `set_availability` RPC + `browse_feed` v2 (curated sound + license surfaced)

**Why:** (a) a creator needs a sanctioned way to write availability windows (owner-guarded, validates non-empty/future via the table CHECK). (b) P0's `browse_feed` exposes `ambient_sound_url` but not the curated sound's title/license — surfacing those lets the browse UI (P4) show "♪ Lakeside Dusk · CC0" instead of a dead control, closing the "dead ambient-sound UI" finding at the read layer. The view stays identity-blind (still no `creator_id`).

**Files:**
- Create: `supabase/migrations/20260526130800_p3_availability_rpc_and_feed_v2.sql`
- Test: `supabase/tests/p3_feed_v2.sql`

- [ ] **Step 1: Write the failing test** (feed still hides creator; now exposes `sound_title` + `sound_license`; `set_availability` inserts a window)

```sql
-- supabase/tests/p3_feed_v2.sql
DO $$
DECLARE cre uuid; cid uuid; it uuid; sid uuid; inst uuid; cnt int;
BEGIN
  -- feed must still be blind
  PERFORM 1 FROM information_schema.columns WHERE table_name='browse_feed' AND column_name='creator_id';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: browse_feed exposes creator_id'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='browse_feed' AND column_name='sound_title';
  IF NOT FOUND THEN RAISE EXCEPTION 'browse_feed missing sound_title'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='browse_feed' AND column_name='sound_license';
  IF NOT FOUND THEN RAISE EXCEPTION 'browse_feed missing sound_license'; END IF;

  -- set_availability inserts a window owned by the creator
  insert into profiles (id, first_name) values (gen_random_uuid(),'cre') returning id into cre;
  insert into cities (slug,name,timezone,is_active) values ('p3f','p3f','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p3f';
  select id into sid from sounds where is_active limit 1;
  insert into itineraries (id,user_id,city_id,sound_id) values (gen_random_uuid(),cre,cid,sid) returning id into it;
  perform set_availability(it, tstzrange(now()+interval '2 days', now()+interval '2 days 4 hours'), cre);
  select count(*) into cnt from availability_windows where itinerary_id=it and creator_id=cre and is_active;
  IF cnt <> 1 THEN RAISE EXCEPTION 'set_availability did not insert one window, got %', cnt; END IF;
  RAISE NOTICE 'feed_v2 + set_availability OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`browse_feed missing sound_title`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260526130800_p3_availability_rpc_and_feed_v2.sql

-- (a) sanctioned availability write
create or replace function set_availability(
  p_itinerary_id uuid, p_window tstzrange, p_actor uuid default auth.uid()
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  insert into availability_windows (itinerary_id, creator_id, window)
  values (p_itinerary_id, p_actor, p_window)   -- table CHECK enforces non-empty + future
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function set_availability(uuid,tstzrange,uuid) from public;
grant execute on function set_availability(uuid,tstzrange,uuid) to authenticated;

-- (b) browse_feed v2 — still identity-blind; now joins the curated sound so the
-- browse UI can show title + licensing instead of a dead control.
create or replace view browse_feed
with (security_invoker = true) as
select
  di.id            as date_instance_id,
  di.city_id,
  date_trunc('hour', di.starts_at) as time_window_start,
  di.status,
  i.id             as itinerary_id,
  i.pay_setting,
  i.vibe_tags,
  i.why_note,
  i.opener,
  i.ambient_sound_url,
  s.title          as sound_title,
  s.license::text  as sound_license,
  s.attribution    as sound_attribution,
  p.neighborhood   as venue_neighborhood
from date_instances di
join itineraries i on i.id = di.itinerary_id
left join sounds s on s.id = i.sound_id
left join places p on p.id = di.venue_id
where di.status = 'seeking';

grant select on browse_feed to anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `feed_v2 + set_availability OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260526130800_p3_availability_rpc_and_feed_v2.sql supabase/tests/p3_feed_v2.sql
git commit -m "$(cat <<'EOF'
P3: set_availability RPC + browse_feed v2 (surface curated sound title/license, still identity-blind)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Full reset verification + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset` applies every P0 + P3 migration and re-runs `seed.sql`. Expect no errors.

- [ ] **Step 2: Run all P3 DB tests**

```bash
for f in supabase/tests/p3_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expect every file exit 0; notices print `… OK`.

- [ ] **Step 3: Run all shared-TS + Edge tests**

```bash
pnpm --filter @after5/business test
deno test supabase/functions/process-media/process_media_test.ts
deno test supabase/functions/generate-plan/dating_fields_test.ts
```
Expect all green.

- [ ] **Step 4: Regenerate types** — `pnpm db:types`. Expect `packages/types/src/database.ts` to include `sounds`, `media_assets`, `availability_windows`, the new `itineraries` columns (`opener`, `sound_id`, `personalized_at`), and the `convert_to_scheduled` / `personalize_itinerary` / `attach_*` / `set_availability` functions + `browse_feed` v2 columns.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "$(cat <<'EOF'
P3: regenerate database types for creation & content-pipeline schema

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec/roadmap coverage (vs P3 'Closes' list):**
- **Evergreen idea creation (browsable template):** generator output tagged `is_evergreen` first-draft (Task 11) + `personalize_itinerary`/`swap_itinerary_venue` (Task 12). ✅
- **Scheduled instance creation (`date_instances`):** `convert_to_scheduled` RPC (Task 7) builds on P0's `date_instances`. ✅
- **Evergreen→scheduled re-collecting availability (the audit's "liked idea, not that time"):** `availability_windows` table (Task 5) + shared guard (Task 6) + DB-enforced containing-window requirement in `convert_to_scheduled` (Task 7) + `set_availability` write path (Task 14). ✅
- **Generator as first draft + personalization (venue swap, vibe, "why", opener, pay):** Tasks 11–12; venue swaps stay vetted-DB-only (Invariant 5 preserved). ✅
- **Media pipeline (upload → transcode/CDN → moderation hook):** buckets (Task 1) + `media_assets` (Task 3) + `process-media` Edge Function (Task 10) + `attach_media` gate so only approved assets attach (Task 8). ✅
- **Moderation queue / UGC ingestion point (P8):** `media_assets.moderation_state='pending'` index = the P8 queue; audit trigger + self-approval guard (Task 3); `process-media` leaves moderation pending (Task 10). ✅
- **Curated ambient-sound library + source/licensing (closes dead ambient UI):** `sounds` table + seed with `source`/`license`/`attribution` (Task 2); shared selection + license-label (Task 9); `browse_feed` v2 surfaces title+license so the UI control is live (Task 14). ✅
- **Google Places photos fetched live, not persisted:** honored — no place-photo persistence added; UGC photos go through `media_assets`, and the generator/feed continue to use existing live/`photo_url` fields. ✅

**Built on P0 (no duplication):** reuses `itineraries`, `date_instances`, `places`, `cities`, `audit_log`, `log_status_transition()`, `payment_preference`, `date_match_status`, `browse_feed`, `set_updated_at()`, `btree_gist`. New tables/columns use `IF NOT EXISTS`; `browse_feed` is `create or replace view` (additive). ✅

**Conventions:** migration filenames `2026052613NNNN_p3_*`; RLS on every table; idempotent `do $$ … duplicate_object …` policies; `set_updated_at()` triggers; `auth.uid()` policies; SECURITY DEFINER RPCs with `revoke … from public; grant … to authenticated`; psql `RAISE EXCEPTION` tests; `Deno.test` for Edge logic; vitest for shared TS. ✅

**Deferred to later phases (intentionally NOT in P3):** the actual moderation *console*/triage UI + auto-classification of UGC (P8); the browse feed *UI* + ambient autoplay/native fallback (P4); offer/lock/shortlist transitions (P5); notifications on conversion (P2); image aesthetic-scoring/Invariant-5b verification workflow for UGC place photos (P8); the React creation screens (web UI is thin over these RPCs — wired in a UI-phase pass, this plan delivers the backend contract + shared logic).

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. Seed `audio_url`s point at the `cdn.tryafter5.app/sounds/` path (the curated public prefix); swap to real asset URLs at execution if the CDN path differs.

**Known follow-ups flagged inline:** (1) `media_assets` self-approval is guarded by a trigger because the owner_all RLS policy is broad — verify in execution that service-role sessions (where `auth.uid()` is null) can still set `approved`. (2) `swap_itinerary_venue` does a minimal `place_id` rewrite; full stop re-hydration is a client read concern and a same-city check is soft until `places.city_id` lands in a later phase.

**Type/name consistency:** enums declared once (`sound_license`, `media_kind`, `media_processing_state`, `media_moderation_state`) before use; column names consistent across tasks (`media_assets.cdn_url`, `itineraries.sound_id`/`opener`/`personalized_at`, `availability_windows.window`, `sounds.audio_url`). RPC signatures match their `grant`/`revoke` argument lists exactly.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p3-creation-content-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Note Task 0 (vitest) and Task 1 (buckets) are prerequisites for the TS and media tasks respectively; everything else follows the migration timestamp order.

**2. Inline Execution** — execute tasks in this session via executing-plans, with checkpoints after Task 7 (conversion invariant) and Task 10 (media pipeline).
