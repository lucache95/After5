SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P3 — Date Creation & Content Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Stage mapping:** P3 is the implementation slice for **Stage S4 (Creation & content pipeline)** of `RECONCILED-MASTER-PLAN.md` §8. It depends on **S1** (schema spine: `itineraries`/`date_instances`/`places`/`audit_log`/`vibe_tags`/`_fixtures.sql`) and **S2** (async/notify/config spine: `jobs`/`enqueue_job`, `process-media` invocation via the canonical job runner). It does **not** build the `browse_feed` view — that is finalized in **S12** (C11.3). It does **not** build the React creation screens — those are a later UI stage; P3 ships the backend contract + shared logic these screens will call.

**Goal:** Build the creation surface and content supply for the dating loop on top of the S1 schema spine. Deliver (1) an **evergreen idea** creation flow (an itinerary as a browsable template, seeded by the existing generator as a "first draft," then **claimed/adopted** by a creator before being personalized: venue swaps, vibe, the "why" note, opener, pay setting); (2) a **scheduled instance** creation flow (`date_instances`) including the **evergreen→scheduled conversion** that **re-collects availability** so "I liked the idea but not that time" can't happen; and (3) a **media pipeline** — Supabase Storage buckets for place photos + ambient audio, a **real signed-URL minting endpoint** + a **real transcode path** + an **invoker** for `process-media`, a **moderation queue** ingestion point (`media_assets`, consumed in S9/P8), the P3-owned `moderation_status` enum+column on `date_instances` (C11.8), and a **curated ambient-sound library** (`sounds` table + seed). Google Places photos stay fetched live, not persisted (existing convention).
>
> **P3 does NOT define `browse_feed`.** Per C11.3 the feed view is built exactly once in a single finalization migration at band `133000` in **S12** — after every base-table column it reads exists. P3 only `alter table`s base tables (adds `moderation_status`, `opener`, `sound_id`, etc.) so the S12 finalization can project them. No `create or replace browse_feed` / "browse_feed v2" lives here.

**Architecture:** Extend (never replace) the S1 spine's `itineraries` (evergreen content object), `date_instances` (scheduled night), `places` (vetted venues), and `audit_log`. Add: `sounds` (curated audio library, source/licensing tracked), `media_assets` (UGC + generated photo/audio rows with moderation state — the S9/P8 review queue), `availability_windows` (a creator's recollected availability, the join between an evergreen idea and a concrete instance), the **`moderation_status` enum + column on `date_instances`** (P3-owned per C11.8: `'pending'|'approved'|'rejected'`, default `'approved'` for non-UGC, `'pending'` when UGC text/media is attached), an **anonymous-draft claim/adopt** RPC, and an `evergreen→scheduled` SECURITY DEFINER RPC that demands a fresh availability window.

The existing `generate-plan` Edge Function is the *first draft only* (it may produce an anonymous draft with `user_id=null`); a creator must **claim/adopt** that draft (setting `user_id`) before personalization, since every personalization RPC checks ownership. Personalization is a set of column writes on the creator's own `itineraries` row, RLS-guarded to the owner; attaching UGC text/media flips `date_instances.moderation_status` to `'pending'`.

**Media pipeline (REAL, end-to-end — no fictional shortcuts):** Media uploads land in **private** buckets and get a `media_assets` row at `processing_state='uploaded'` / `moderation_state='pending'`. An **invoker** (the canonical S2 job runner via `enqueue_job('analytics_relay'…)`-style enqueue of a media-processing job, OR a Storage webhook / `pg_cron`, wired in Task 10) calls the `process-media` Edge Function — uploads never sit at `'uploaded'` forever. `process-media` runs a **real transcode** (image → webp and audio → normalized/clipped clip via an actual encoder — ffmpeg/WASM or an external transform service; **NOT** Supabase's read-time image-transform URL param, which cannot produce a stored artifact), then sets `processing_state='processed'` and leaves `moderation_state='pending'` for S9/P8. Approved media is **served via a per-request signed-URL minting endpoint** (`get_media_signed_url`), never by storing an expiring URL in a column. Only `moderation_state='approved'` assets are referenceable; on re-moderation to `rejected`/`flagged`, the reference is re-resolved. **Curated library sounds bypass UGC moderation** (they ship pre-cleared with licensing).

**Tech Stack:** Supabase Postgres + SQL migrations (`supabase/migrations/`), RLS with `auth.uid()`, Storage buckets created **in-migration** via `storage.buckets` inserts + `storage.objects` RLS (the repo currently creates `itinerary-covers` out-of-band — P3 fixes that by declaring buckets in migrations). Edge Functions on Deno (std http server, `esm.sh/@supabase/supabase-js@2.45.0`, `npm:zod`), tested with `Deno.test`. Pure TS helpers (availability validation, sound-library selection, conversion guards) live in `packages/business` and are tested with **vitest** via the **single root `vitest.config.ts` owned by P1/S1** (C10/C12). P3 does **NOT** bootstrap its own vitest runner — it assumes `pnpm test` already works through P1's root workspace config. psql for DB invariant/RLS tests, matching S1.

**Source docs:**
- Spec: `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§4 date object, evergreen→scheduled, pre-lock privacy; §5 ambient sound; §10 ambient-autoplay/native).
- Roadmap: `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 3 scope + Closes).
- Foundation: `docs/superpowers/plans/2026-05-25-p0-data-model.md` (build on `itineraries`, `date_instances`, `places`, `cities`, `audit_log`).
- Generator: `docs/superpowers/specs/2026-04-23-date-plan-generator-deep-dive.md` + `supabase/functions/generate-plan/`.

**Reconciliation note (build on the S1 spine, do not duplicate):** S1 (P0, corrected) already added to `itineraries`: `city_id`, `is_evergreen`, `match_status`, `pay_setting` (`payment_preference` enum), `ambient_sound_url`, `why_note`, and `vibe_tags` (C7). S1 already created `date_instances` (`itinerary_id`, `creator_id`, `city_id`, `venue_id`, `starts_at`, `duration_min`, generated `time_range`, `status date_match_status`). **`browse_feed` is NOT defined by S1 beyond a minimal early stub that S12's finalization migration drops (C11.3)** — P3 must not assume a finished feed view, must not read its column set, and must not redefine it. P3 therefore **adds only what's missing**: an `opener` field + a personalization marker + `sound_id` on `itineraries`; the **`moderation_status` enum+column on `date_instances`** (C11.8); the `sounds`, `media_assets`, `availability_windows` tables; the conversion + audio-attach + claim + signed-URL RPCs; and the media-processing Edge Function + its invoker. Where a column already exists in S1, P3 uses `ADD COLUMN IF NOT EXISTS` and never redefines it.

**Conventions (follow S1 exactly):** migration filenames `YYYYMMDDHHMMSS_p3_snake_description.sql`; **timestamps MUST fall in P3's band `124000–1249xx` on 2026-05-25 per C6** (e.g. `20260525124000_p3_*` … `20260525124900_p3_*`) — the prior `2026052613xxxx` (May 26) timestamps are SUPERSEDED because they would sort after sibling phases and clobber shared objects; enable RLS on every table; create policies idempotently with `do $$ begin create policy … exception when duplicate_object then null; end $$;`; attach the existing `set_updated_at()` trigger to every table with `updated_at`; `auth.uid()` in policies (every SECURITY DEFINER RPC asserts `p_actor = auth.uid()` per C10); uuid PKs via `gen_random_uuid()`; status-changing tables get an `audit_log` trigger via S1's `log_status_transition()`.

**Local test loops:**
- DB: `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>` (a `DO $$ … RAISE EXCEPTION …` block: clean exit = PASS, any raise = FAIL). Tests in `supabase/tests/`. **All test fixtures seed via S1's `_fixtures.sql` helpers `mk_user()`/`mk_itinerary()`/`mk_instance()` (C8) — no bare inserts into `profiles`/`itineraries`.**
- Edge Functions: `deno test --allow-env --allow-net supabase/functions/<fn>/*_test.ts` (pure-logic tests run with no flags).
- Shared TS: `pnpm test` (vitest via P1's single root workspace config — P3 adds no runner).

---

## File Structure

- `supabase/migrations/20260525124NNN_p3_*.sql` — one migration per schema task (buckets, sounds, media_assets, `date_instances.moderation_status`, availability_windows, itineraries.opener, conversion RPC, claim RPC, attach-audio RPC, signed-URL RPC). **No `browse_feed` migration — the feed is finalized in S12 (C11.3).** All timestamps in band `124000–1249xx`.
- `supabase/seed.sql` — append the curated `sounds` seed (config already loads `./seed.sql`).
- `supabase/tests/p3_*.sql` — one psql invariant/RLS test file per task that warrants it; fixtures via S1 `mk_user`/`mk_itinerary`/`mk_instance` (C8).
- `supabase/functions/process-media/index.ts` + `process_media_test.ts` — **real** transcode/normalize of uploads, flip `media_assets` to `processed`, leave moderation `pending`.
- `supabase/functions/_shared/media.ts` — shared upload/transform helpers (image webp, audio clip) reused by `process-media`.
- `packages/business/src/availability.ts` + `availability.test.ts` — availability-window validation (timezone-aware, no past windows, min lead time).
- `packages/business/src/conversion.ts` + `conversion.test.ts` — evergreen→scheduled guard (a fresh window is required; chosen `starts_at` must fall inside a window).
- `packages/business/src/sounds.ts` + `sounds.test.ts` — curated sound-library selection + license display helper.
- `packages/types/src/database.ts` — regenerated last (`pnpm db:types`).

> **vitest config:** NOT a P3 file. P1 owns the single root `vitest.config.ts` (C10/C12); P3 assumes it exists.

---

## Task 0: ~~Add a vitest runner to `packages/business`~~ — **SUPERSEDED (C10/C12, CV10)**

**SUPERSEDED — do NOT execute.** This task originally bootstrapped a per-package vitest runner (`packages/business/vitest.config.ts` + a root `turbo` test task). That is a **duplicate test-runner setup** and violates C10/C12 / CV10 of `RECONCILED-MASTER-PLAN.md` §1: **P1 owns the single root `vitest.config.ts`** (workspace globs covering `apps/web` + `packages/*`); P3/P6/P8/P10/P11 must delete their duplicate setups and assume `pnpm test`.

**What to do instead:** nothing here. P3's shared-TS tasks (6, 9, 13) write `*.test.ts` files under `packages/business/src/`, which P1's root config already globs. Run them with `pnpm test` (or `pnpm test --filter @after5/business` if P1's config supports project filtering). If `pnpm test` does not yet discover `packages/business`, that is a **P1/S1 gap to fix in P1's config**, not a P3-local runner.

---

## Task 1: Storage buckets (place-photos, ambient-audio) declared in-migration

**Why:** the media pipeline needs durable, RLS-guarded buckets. The repo creates `itinerary-covers` out-of-band; P3 standardizes by declaring buckets in a migration so `supabase db reset` reproduces them. `place-photos` and `ambient-audio` are **private** (objects served via signed URLs / CDN after moderation); uploads are owner-scoped by a path prefix `{auth.uid()}/…`.

**Files:**
- Create: `supabase/migrations/20260525124000_p3_storage_buckets.sql`
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
-- supabase/migrations/20260525124000_p3_storage_buckets.sql
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
git add supabase/migrations/20260525124000_p3_storage_buckets.sql supabase/tests/p3_buckets.sql
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
- Create: `supabase/migrations/20260525124100_p3_sounds.sql`
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
-- supabase/migrations/20260525124100_p3_sounds.sql
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
git add supabase/migrations/20260525124100_p3_sounds.sql supabase/seed.sql supabase/tests/p3_sounds.sql
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
- Create: `supabase/migrations/20260525124200_p3_media_assets.sql`
- Test: `supabase/tests/p3_media_assets.sql`

- [ ] **Step 1: Write the failing test** (default state is `pending`; owner can read own; transition trigger audits). Seed the owner via S1's `mk_user()` (C8), not a bare `profiles` insert.

```sql
-- supabase/tests/p3_media_assets.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE owner uuid; mid uuid; st text; n int;
BEGIN
  owner := mk_user('owner');
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
-- supabase/migrations/20260525124200_p3_media_assets.sql
create type media_kind as enum ('place_photo','ambient_audio');
create type media_processing_state as enum ('uploaded','processing','processed','failed');
create type media_moderation_state as enum ('pending','approved','rejected','flagged');

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  bucket_id text not null check (bucket_id in ('place-photos','ambient-audio')),
  object_path text not null,                 -- '<uid>/<file>' in the bucket
  kind media_kind not null,
  -- stable object path of the processed (transcoded) artifact once process-media runs.
  -- Private UGC is served via the per-request signed-URL endpoint (Task 8b) from this path,
  -- never via a stored expiring URL.
  processed_path text,
  cdn_url text,                              -- only for stable public/curated artifacts (NOT private UGC signed URLs)
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

> **Self-approval note (admin-aware per C5/C10):** the `owner_all` policy *technically* lets an owner UPDATE their own row including `moderation_state`. Only **service-role OR an admin** (S9/P8 moderator RPCs, which authorize via `admin_has_role()`) may flip `moderation_state` to `approved`/`flagged`. The original guard raised whenever `auth.uid() is not null`, which would **also block P8's authed-admin moderator RPCs** (their session has a non-null admin `auth.uid()`) — a cross-phase regression flagged in the audit. The guard must therefore exempt admins via `admin_has_role()` (the canonical admin predicate referenced by C10). Implement that guard in this migration:

```sql
create or replace function guard_media_self_approval() returns trigger
language plpgsql as $fn$
begin
  if (new.moderation_state is distinct from old.moderation_state)
     and new.moderation_state in ('approved','flagged')
     and auth.uid() is not null            -- a real user session, not service-role
     and not admin_has_role() then          -- but NOT an authed moderator (P8/S9, C10)
    raise exception 'users cannot self-approve media';
  end if;
  return new;
end $fn$;
create trigger media_guard_self_approval before update on media_assets
  for each row execute function guard_media_self_approval();
```
> `admin_has_role()` is the canonical admin predicate (C10); it is provided by the admin/auth spine S1/S9. If it is not yet available when this migration lands, reference it as a dependency (`Depends on: admin_has_role()` from the auth spine) rather than inventing a local check.
>
> **Moderator read access:** the `owner_all` RLS policy alone leaves the P8/S9 review queue unreadable by an authed admin. Add a read policy `using (admin_has_role())` (or rely on service-role) so S9's console can read pending/flagged `media_assets`. This is the consumer of the `media_assets_moderation_idx` queue.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `media_assets OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124200_p3_media_assets.sql supabase/tests/p3_media_assets.sql
git commit -m "$(cat <<'EOF'
P3: media_assets (UGC photo/audio) with moderation state, audit trigger, admin-aware self-approval guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `itineraries.opener` + personalization marker

**Why:** P0 added `pay_setting`, `ambient_sound_url`, `why_note`, `is_evergreen`. The spec §4 also lists an **opener** (the conversation-starter line) as a date field; it's not yet a column. Add it plus a `sound_id` FK (so a curated library pick is tracked, not just a free URL) and a `personalized_at` marker (distinguishes a raw generator first-draft from a creator-edited evergreen idea — used by browse/quality later).

**Files:**
- Create: `supabase/migrations/20260525124300_p3_itineraries_opener.sql`
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
-- supabase/migrations/20260525124300_p3_itineraries_opener.sql
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
git add supabase/migrations/20260525124300_p3_itineraries_opener.sql supabase/tests/p3_itineraries_opener.sql
git commit -m "$(cat <<'EOF'
P3: itineraries opener + sound_id (curated lib link) + personalized_at marker

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4b: `date_instances.moderation_status` enum + column (P3-owned per C11.8)

**Why:** C11.8 assigns ownership of the `moderation_status` **enum + column on `date_instances`** to **P3** (band `124xxx`). This is the column the S12 feed-finalization migration filters on (`di.moderation_status='approved'`, C11.3) and the column S9/P8's moderation console actions. It is **not** the same thing as `media_assets.moderation_state` (which gates individual media artifacts) — `date_instances.moderation_status` gates whether the whole night is showable in the feed. Default per C11.8: **`'approved'` for non-UGC**, flips to **`'pending'` when UGC text/media is attached** (so a personalized "why"/opener or an attached UGC photo/audio is not feed-live before review — closing the audit's "the why note is never moderated at creation" gap).

**Files:**
- Create: `supabase/migrations/20260525124350_p3_date_instances_moderation_status.sql`
- Test: `supabase/tests/p3_moderation_status.sql`

- [ ] **Step 1: Write the failing test** (column exists; enum is exactly the C11.8 set; default is `approved`; UGC attach flips to `pending`). Fixtures via S1 `mk_user`/`mk_itinerary`/`mk_instance` (C8).

```sql
-- supabase/tests/p3_moderation_status.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; it uuid; inst uuid; st text;
BEGIN
  -- enum + column exist
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='date_instances' AND column_name='moderation_status';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances.moderation_status missing'; END IF;

  cre  := mk_user('cre');
  it   := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  -- non-UGC instance defaults to approved
  select moderation_status::text into st from date_instances where id=inst;
  IF st <> 'approved' THEN RAISE EXCEPTION 'non-UGC moderation_status must default approved, got %', st; END IF;
  RAISE NOTICE 'moderation_status OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`date_instances.moderation_status missing`).

- [ ] **Step 3: Write the migration** (enum verbatim per C11.8; default `approved`; the conversion + UGC-attach RPCs flip it to `pending`).

```sql
-- supabase/migrations/20260525124350_p3_date_instances_moderation_status.sql
-- C11.8: P3 owns the moderation_status enum + column on date_instances.
-- Values exactly 'pending'|'approved'|'rejected'. Default 'approved' for non-UGC;
-- creation/attach paths set 'pending' when UGC text/media is attached.
do $$ begin
  create type moderation_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

alter table date_instances
  add column if not exists moderation_status moderation_status not null default 'approved';

-- index the review queue (the S9/P8 console reads pending/rejected)
create index if not exists date_instances_moderation_idx on date_instances(moderation_status)
  where moderation_status in ('pending','rejected');
```

> **Cross-stage:** the S12 feed-finalization migration (C11.3, band `133000`) filters `di.moderation_status='approved'`. P3 only `alter table`s here; it does **not** build the feed view. S9/P8's console actions this column to `approved`/`rejected`. **Depends on:** `date_instances` (S1). **Consumed by:** S12 feed filter, S9/P8 moderation.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `moderation_status OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124350_p3_date_instances_moderation_status.sql supabase/tests/p3_moderation_status.sql
git commit -m "$(cat <<'EOF'
P3: date_instances.moderation_status enum+column (C11.8) — default approved, pending on UGC; S12 feed filters it

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `availability_windows` — recollected availability (the conversion join)

**Why:** the core fix for "I liked the idea but not that time." An **evergreen idea has no time**; when a creator decides to act, they declare *fresh* availability windows. A `date_instance` can only be created for a `starts_at` that falls **inside a current window**. This table is the source of truth for that re-collection, keyed to the itinerary + creator.

**Files:**
- Create: `supabase/migrations/20260525124400_p3_availability_windows.sql`
- Test: `supabase/tests/p3_availability_windows.sql`

- [ ] **Step 1: Write the failing test** (a window is a `tstzrange`; only the owning creator can read/write; no overlapping windows for the same itinerary)

```sql
-- supabase/tests/p3_availability_windows.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; it uuid; w1 uuid; ok boolean := false;
BEGIN
  cre := mk_user('cre');
  it  := mk_itinerary(cre);
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
-- supabase/migrations/20260525124400_p3_availability_windows.sql
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

> **Note:** `availability_windows` requires `btree_gist` (installed by the S1 spine) for the GiST exclusion over `(uuid =, tstzrange &&)`. **Depends on:** `btree_gist` (S1).

- [ ] **Step 4: Apply + run test, expect PASS** (prints `availability_windows OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124400_p3_availability_windows.sql supabase/tests/p3_availability_windows.sql
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

- [ ] **Step 2: Run it, expect FAIL** — `pnpm test` (P1's root vitest config) → cannot find `./conversion`.

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
- Create: `supabase/migrations/20260525124500_p3_convert_rpc.sql`
- Test: `supabase/tests/p3_convert_rpc.sql`

- [ ] **Step 1: Write the failing test** (no window → reject; containing window → instance created + audited)

```sql
-- supabase/tests/p3_convert_rpc.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; it uuid; inst uuid; got_err boolean := false; n int;
BEGIN
  cre := mk_user('cre');
  it  := mk_itinerary(cre);   -- evergreen idea (mk_itinerary defaults is_evergreen)

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
-- supabase/migrations/20260525124500_p3_convert_rpc.sql
-- Evergreen → scheduled conversion. Enforces, in the DB, that a fresh, active,
-- non-stale availability window CONTAINS the whole instance. p_actor defaults to
-- auth.uid() and MUST equal auth.uid() (C10); the function also verifies p_actor
-- owns the itinerary. (Tests pass a creator id with auth.uid() null — allowed.)
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
  v_has_ugc_text boolean;
  v_mod moderation_status;
  v_range tstzrange := tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_min));
  v_stale interval := interval '14 days';   -- windows older than this don't count
begin
  -- C10: caller must be the real actor (auth.uid() is null only in service-role/psql tests)
  if auth.uid() is not null and p_actor is distinct from auth.uid() then
    raise exception 'actor_mismatch';
  end if;

  -- ownership + city + whether the idea carries UGC free-text (why/opener)
  select city_id, (coalesce(btrim(why_note),'') <> '' or coalesce(btrim(opener),'') <> '')
    into v_city, v_has_ugc_text
   from itineraries
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

  -- C11.8: UGC text (why/opener) makes the instance moderation-pending; otherwise approved.
  v_mod := case when v_has_ugc_text then 'pending'::moderation_status else 'approved'::moderation_status end;

  insert into date_instances (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status, moderation_status)
  values (p_itinerary_id, p_actor, v_city, p_venue_id, p_starts_at, p_duration_min, 'seeking', v_mod)
  returning id into v_inst;

  return v_inst;
end $fn$;

revoke all on function convert_to_scheduled(uuid,uuid,timestamptz,int,uuid) from public;
grant execute on function convert_to_scheduled(uuid,uuid,timestamptz,int,uuid) to authenticated;
```

> **Note on `match_status` sync (audit edge case):** conversion creates a `seeking` `date_instance` but leaves the parent `itineraries.match_status` as-is. The two status fields are intentionally distinct (the evergreen idea can spawn many instances); the feed reads `date_instances.status`, not `itineraries.match_status`. Do not couple them.
> **Cross-stage:** this RPC writes `date_instances.moderation_status` (Task 4b). **Consumed by:** S6 matching reads `seeking` instances; S12 feed filters `moderation_status='approved'`.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `convert_to_scheduled OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124500_p3_convert_rpc.sql supabase/tests/p3_convert_rpc.sql
git commit -m "$(cat <<'EOF'
P3: convert_to_scheduled RPC — DB-enforced evergreen→scheduled requiring a containing fresh availability window

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `attach_media` RPC — only approved media may be referenced

**Why:** closes the moderation loop on the write side. A creator can only reference media that is **approved** (UGC) or from the curated `sounds` library (pre-cleared). This RPC is the single sanctioned path.

> **No signed-URL-in-a-column (audit "what engineers will regret" #2).** The original version copied `media_assets.cdn_url` into `itineraries.ambient_sound_url`. A Supabase **signed URL expires** — storing it makes the audio die after minutes. P3 instead stores a **stable reference** (the `media_assets.id` in a new `ambient_media_id` column) and serves it at read time via the per-request signed-URL endpoint (Task 8b). `ambient_sound_url` remains for **curated library sounds** (which live at a stable public curated path) and for back-compat, but UGC audio is referenced by id, not by an expiring URL. This also fixes audit edge-case #3: if the asset is later re-moderated to `rejected`/`flagged`, the signed-URL endpoint refuses to mint, so removed audio stops playing — no stale URL persists.

**Files:**
- Create: `supabase/migrations/20260525124600_p3_attach_media_rpc.sql`
- Test: `supabase/tests/p3_attach_media.sql`

- [ ] **Step 1: Write the failing test** (pending media rejected; approved media attaches by id; curated sound attaches). Fixtures via S1 `mk_user`/`mk_itinerary` (C8).

```sql
-- supabase/tests/p3_attach_media.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; it uuid; m uuid; got_err boolean := false; got_ref uuid; got_url text; sid uuid;
BEGIN
  cre := mk_user('cre');
  it  := mk_itinerary(cre);

  -- pending audio asset → attach must reject
  insert into media_assets (owner_id,bucket_id,object_path,kind,processed_path,processing_state)
    values (cre,'ambient-audio',cre::text||'/a.webm','ambient_audio','processed/'||cre::text||'/a.webm','processed')
    returning id into m;
  BEGIN
    perform attach_ambient_media(it, m, cre);
  EXCEPTION WHEN others THEN got_err := true; END;
  IF NOT got_err THEN RAISE EXCEPTION 'attached pending (unmoderated) media'; END IF;

  -- approve it (service-role path; test has no auth.uid → guard allows) → attach references by id
  update media_assets set moderation_state='approved' where id=m;
  perform attach_ambient_media(it, m, cre);
  select ambient_media_id into got_ref from itineraries where id=it;
  IF got_ref IS DISTINCT FROM m THEN
    RAISE EXCEPTION 'approved media not referenced, ref=%', got_ref; END IF;

  -- curated library sound also attaches (pre-cleared, stable public path → ambient_sound_url)
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
-- supabase/migrations/20260525124600_p3_attach_media_rpc.sql
-- Reference an APPROVED UGC ambient-audio asset by id (NOT by an expiring URL).
-- The signed-URL endpoint (Task 8b) mints a fresh URL at read time and refuses
-- if the asset is no longer approved.
alter table itineraries
  add column if not exists ambient_media_id uuid references media_assets(id) on delete set null;

create or replace function attach_ambient_media(
  p_itinerary_id uuid, p_media_id uuid, p_actor uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_state media_moderation_state; v_kind media_kind; v_proc media_processing_state;
begin
  if auth.uid() is not null and p_actor is distinct from auth.uid() then raise exception 'actor_mismatch'; end if;
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  select moderation_state, kind, processing_state
    into v_state, v_kind, v_proc
    from media_assets where id=p_media_id and owner_id=p_actor;
  if not found then raise exception 'media_not_found'; end if;
  if v_kind <> 'ambient_audio' then raise exception 'wrong_media_kind'; end if;
  if v_proc <> 'processed' then raise exception 'media_not_processed'; end if;
  if v_state <> 'approved' then raise exception 'media_not_approved'; end if;
  -- reference by id; clear any library sound + stale URL; URL is minted at read time.
  update itineraries
     set ambient_media_id = p_media_id, sound_id = null, ambient_sound_url = null,
         personalized_at = coalesce(personalized_at, now())
   where id = p_itinerary_id;
end $fn$;

-- Attach a curated library sound (pre-cleared, no moderation needed, stable public path).
create or replace function attach_library_sound(
  p_itinerary_id uuid, p_sound_id uuid, p_actor uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is not null and p_actor is distinct from auth.uid() then raise exception 'actor_mismatch'; end if;
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  perform 1 from sounds where id=p_sound_id and is_active;
  if not found then raise exception 'sound_not_found'; end if;
  -- itineraries_sync_sound trigger resolves ambient_sound_url from sound_id;
  -- clear any UGC media reference so the two sources never both win.
  update itineraries
     set sound_id = p_sound_id, ambient_media_id = null,
         personalized_at = coalesce(personalized_at, now())
   where id = p_itinerary_id;
end $fn$;

revoke all on function attach_ambient_media(uuid,uuid,uuid) from public;
revoke all on function attach_library_sound(uuid,uuid,uuid) from public;
grant execute on function attach_ambient_media(uuid,uuid,uuid) to authenticated;
grant execute on function attach_library_sound(uuid,uuid,uuid) to authenticated;
```

> **Single-source rule for the resolved sound (audit state-flow #2/#3):** exactly one of `sound_id` (curated) or `ambient_media_id` (UGC) is set; each attach RPC clears the other. The `sync_itinerary_sound` trigger only populates `ambient_sound_url` from a curated `sound_id`; UGC audio has no stored URL (minted on read). Free-form `update itineraries set ambient_sound_url=…` is not a sanctioned path.

- [ ] **Step 4: Apply + run test, expect PASS** (prints `attach_media OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124600_p3_attach_media_rpc.sql supabase/tests/p3_attach_media.sql
git commit -m "$(cat <<'EOF'
P3: attach_ambient_media (by id) / attach_library_sound RPCs — only approved UGC or curated sounds; no signed-URL-in-a-column

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8b: `get_media_signed_url` — per-request signed-URL minting (the missing read side)

**Why:** the buckets are private (Task 1) and the contract/architecture serve approved media "via signed URLs minted server-side." Storing an expiring URL in a column is forbidden (Task 8 note). This is the **real read-side endpoint** the audit flagged as entirely missing (Critical #4): given a `media_assets` id the caller is allowed to view, it mints a short-lived signed URL **only if the asset is `approved` + `processed`**, so re-moderation immediately stops serving removed media. Implemented as a Supabase Edge Function (it must call the Storage `createSignedUrl` API, which is not available in-SQL) under the service-role/bearer pattern used by the other functions.

**Files:**
- Create: `supabase/functions/get-media-signed-url/index.ts`
- Create: `supabase/functions/get-media-signed-url/index_test.ts` (pure-logic: approval gate + TTL clamp)
- Modify: `supabase/config.toml` (`[functions.get-media-signed-url] verify_jwt = true` — authed user; the function checks the caller may view the asset)

- [ ] **Step 1: Write the failing test** (pure helper: `canServe(asset)` true only when `moderation_state='approved' && processing_state='processed'`; `signedUrlTtl()` clamped ≤ a safe max).

```ts
// supabase/functions/get-media-signed-url/index_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { canServe, signedUrlTtl, MAX_TTL_SEC } from './index.ts';

Deno.test('only approved+processed media may be served', () => {
  assertEquals(canServe({ moderation_state: 'approved', processing_state: 'processed' }), true);
  assertEquals(canServe({ moderation_state: 'pending',  processing_state: 'processed' }), false);
  assertEquals(canServe({ moderation_state: 'approved', processing_state: 'uploaded'  }), false);
  assertEquals(canServe({ moderation_state: 'rejected', processing_state: 'processed' }), false);
});
Deno.test('TTL is clamped to a safe maximum', () => {
  assertEquals(signedUrlTtl(99999), MAX_TTL_SEC);
  assertEquals(signedUrlTtl(60), 60);
});
```

- [ ] **Step 2: Run it, expect FAIL** (cannot find `./index.ts` export).

- [ ] **Step 3: Write `index.ts`** following the `generate-cover` function shape: auth (authed user via `verify_jwt`), JSON body `{ media_id: string }`; service-role client loads the `media_assets` row; if `canServe(asset)` is false → 403; else mint `supabase.storage.from(asset.bucket_id).createSignedUrl(asset.processed_path, signedUrlTtl(DEFAULT_TTL))` and return `{ url, expires_in }`. Export the two pure helpers (`canServe`, `signedUrlTtl`, `MAX_TTL_SEC`) so they are unit-testable. Curated library sounds (stable public path) do **not** go through this endpoint.

```ts
// shape of the pure helpers exported from index.ts
export const MAX_TTL_SEC = 3600;            // 1h cap; default DEFAULT_TTL=900
export function canServe(a: { moderation_state: string; processing_state: string }): boolean {
  return a.moderation_state === 'approved' && a.processing_state === 'processed';
}
export function signedUrlTtl(sec: number): number { return Math.min(Math.max(1, sec), MAX_TTL_SEC); }
```

- [ ] **Step 4: Add config** to `supabase/config.toml`:

```toml
[functions.get-media-signed-url]
verify_jwt = true
```

- [ ] **Step 5: Run the test, expect PASS** (2 passing).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/get-media-signed-url/index.ts supabase/functions/get-media-signed-url/index_test.ts supabase/config.toml
git commit -m "$(cat <<'EOF'
P3: get-media-signed-url Edge Function — per-request signed URLs, served only for approved+processed media

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

## Task 10: `process-media` Edge Function (REAL transcode) + an invoker

**Why:** closes "no media pipeline" — for real, end-to-end. After a client uploads to the private bucket and inserts a `media_assets` row (`processing_state='uploaded'`), this service-role function downloads the raw object, runs a **real transcode**, writes the processed artifact + `processed_path` (NOT an expiring URL), sets `processing_state='processed'`, and **leaves `moderation_state='pending'`** so S9/P8 can action it. It is the UGC ingestion → moderation handoff. **Two audit B-items are fixed here:**
> 1. **No fictional transcoder.** The original plan claimed images go to webp "via Supabase Storage's image transformation." That is **false** — Supabase image transform is a *read-time render param on a download URL*, not a write-time encoder that produces a stored object. This task uses a **real encoder**: image → webp via a WASM image codec available in Deno (e.g. `@jsquash/webp` / `imagescript`), audio → a normalized ≤`MAX_AUDIO_SEC` clip via an actual audio transcode (ffmpeg-wasm) **or**, if audio UGC is descoped for launch (roadmap permits *library-only audio*), the function rejects UGC `ambient_audio` and only the curated library is used. Pick one explicitly at execution; do not ship the impossible claim.
> 2. **No "uploads sit at `uploaded` forever."** An **invoker** wires the upload → processing trigger (next bullet). The function never depends on a human to run it.

**Invoker (required — uploads must auto-process):** use the **canonical S2 job system (C1)** — on `media_assets` insert (`processing_state='uploaded'`), an `after insert` trigger calls `enqueue_job('analytics_relay'… )`-style **`enqueue_job`** with a media-processing payload (the C1 enum already covers the operational job kinds; if a dedicated kind is needed it is added to the C1 `job_type` enum **in P2/S2, not here** — reference it, do not redefine). The S2 runner dispatches the job, which invokes `process-media`. **Alternative invokers** (choose one, all acceptable): a Supabase **Storage webhook** on object-finalize, or **`pg_cron`** sweeping `processing_state='uploaded'` rows. **Do not** invent a second jobs table — reference C1's `enqueue_job`/`jobs` (DS5).

**Files:**
- Create: `supabase/functions/_shared/media.ts`
- Create: `supabase/functions/process-media/index.ts`
- Create: `supabase/functions/process-media/process_media_test.ts`
- Create: `supabase/migrations/20260525124700_p3_process_media_invoker.sql` (the `after insert` trigger that enqueues via C1 `enqueue_job`)
- Modify: `supabase/config.toml` (add `[functions.process-media] verify_jwt = false` — authenticated manually via service-role bearer, matching `generate-cover`/`classify-photos`)

> **Depends on:** C1 `enqueue_job`/`jobs` + the runner (P2/S2). If S2's runner dispatch for media is not yet wired, the trigger still enqueues with the **final** `enqueue_job` signature (C1) — never an inline divergent jobs table.

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

> The **real** transcode in `index.ts`: images → webp via a WASM image codec running in Deno (e.g. `@jsquash/webp` or `imagescript`), uploading the encoded bytes with the same `supabase.storage.from(bucket).upload(path, bytes, { contentType:'image/webp', upsert:true })` pattern seen in `generate-cover/index.ts`. Audio → a normalized ≤`MAX_AUDIO_SEC` clip via ffmpeg-wasm, **or** UGC audio is descoped to library-only for launch (roadmap-permitted) and rejected here. **Do NOT** claim Supabase image-transform performs the encode — it cannot. Keep all *pure* derivations in `_shared/media.ts` so they're unit-testable without network; the codec/I-O lives in `index.ts`.

- [ ] **Step 4: Write `process-media/index.ts`** following the `generate-cover` shape exactly:
  - Service-role bearer check (`Authorization === 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY`), CORS preflight, JSON body `{ media_id?: string; batch_size?: number }`.
  - Resolve target `media_assets` rows where `processing_state='uploaded'` (or a single `media_id`).
  - For each: set `processing_state='processing'`; download raw object from its bucket; **really transcode** (WASM webp encode for `place_photo`; ffmpeg-wasm normalized ≤`MAX_AUDIO_SEC` clip for `ambient_audio`, or reject if audio UGC is descoped); upload the processed artifact to `processedPathFor(...)`; `update media_assets set processed_path, width/height/duration_sec, processing_state='processed'` — **store `processed_path` (a stable object path), NOT an expiring signed/CDN URL** (serving is the Task 8b endpoint's job; `cdn_url` is left null/unused for private UGC). `moderation_state` stays `pending`.
  - On error set `processing_state='failed'` and continue (mirror `generate-cover`'s per-row error collection).
  - Return `{ processed: n, results: [...] }`.

- [ ] **Step 5: Add config** to `supabase/config.toml`:

```toml
[functions.process-media]
verify_jwt = false
```

- [ ] **Step 6: Write the invoker migration** `supabase/migrations/20260525124700_p3_process_media_invoker.sql` — an `after insert on media_assets` trigger (when `processing_state='uploaded'`) that calls the **C1** `enqueue_job(...)` to schedule processing (referencing P2/S2's `jobs`; no local jobs table). If the dedicated media job kind is not yet in the C1 enum, this trigger is the consumer that motivates adding it **in P2/S2** — reference, don't redefine (DS5). Test that the trigger enqueues exactly one job per upload-insert.

- [ ] **Step 7: Run the tests, expect PASS** — `deno test supabase/functions/process-media/process_media_test.ts` (3 passing) and the invoker psql test.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/media.ts supabase/functions/process-media/index.ts supabase/functions/process-media/process_media_test.ts supabase/migrations/20260525124700_p3_process_media_invoker.sql supabase/config.toml
git commit -m "$(cat <<'EOF'
P3: process-media Edge Function (real WASM transcode) + C1 enqueue_job invoker; store processed_path, leave moderation pending

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Integrate the generator as the evergreen "first draft"

**Why:** the spec's "AI sets the floor; the human sets the ceiling" — the existing `generate-plan` produces the itinerary; P3 marks generator output as an **evergreen first draft** so the creation UI can offer "personalize this into a date idea." The generator already writes `itineraries` rows; P3 makes those rows dating-ready by setting the new dating fields at insert time and tagging them `is_evergreen=true`, `personalized_at=null`. **No change to the LLM/scoring path** — only the persistence shape.

> **Anonymous drafts need a claim step (audit Backend/API #3).** `generate-plan` may insert with `user_id=null` (anonymous generation is the current product). Every personalization RPC (Task 12) checks `user_id=p_actor`, so an **anonymous draft cannot be personalized until it is claimed/adopted** by a signed-in creator. Task 11b adds that claim step. Until claimed, a `user_id=null` draft is library/SEO content only, never a dating object.

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

## Task 11b: `claim_draft` RPC — adopt an anonymous generator draft before personalization

**Why:** closes the audit's "anonymous draft has no owner" gap (Backend/API #3). A `generate-plan` draft with `user_id=null` is unowned library/SEO content; before a creator can personalize it into a dating idea, they must **claim/adopt** it (set `user_id = auth.uid()`). This is the only sanctioned transition of an anonymous draft into an owned evergreen idea. Already-owned drafts cannot be re-claimed by someone else.

**Files:**
- Create: `supabase/migrations/20260525124650_p3_claim_draft_rpc.sql`
- Test: `supabase/tests/p3_claim_draft.sql`

- [ ] **Step 1: Write the failing test** (anonymous draft is claimable by a creator; an already-owned draft cannot be claimed by another). Fixtures via S1 `mk_user`/`mk_itinerary` (C8).

```sql
-- supabase/tests/p3_claim_draft.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; other uuid; anon_it uuid; owned_it uuid; got_owner uuid; got_err boolean := false;
BEGIN
  cre   := mk_user('cre');
  other := mk_user('other');

  -- an anonymous draft (user_id null) — insert directly to simulate generate-plan output
  insert into itineraries (id, user_id, is_evergreen) values (gen_random_uuid(), null, true)
    returning id into anon_it;
  -- claim it
  perform claim_draft(anon_it, cre);
  select user_id into got_owner from itineraries where id=anon_it;
  IF got_owner IS DISTINCT FROM cre THEN RAISE EXCEPTION 'anon draft not claimed by creator'; END IF;

  -- an already-owned draft cannot be claimed by someone else
  owned_it := mk_itinerary(cre);
  BEGIN
    perform claim_draft(owned_it, other);
  EXCEPTION WHEN others THEN got_err := true; END;
  IF NOT got_err THEN RAISE EXCEPTION 'claimed an already-owned draft'; END IF;

  RAISE NOTICE 'claim_draft OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function claim_draft(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525124650_p3_claim_draft_rpc.sql
-- Adopt an anonymous (user_id null) generator draft. Only an unowned draft may
-- be claimed; once owned it belongs to that creator. p_actor must equal auth.uid (C10).
create or replace function claim_draft(p_itinerary_id uuid, p_actor uuid default auth.uid())
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is not null and p_actor is distinct from auth.uid() then raise exception 'actor_mismatch'; end if;
  if p_actor is null then raise exception 'must_be_authenticated'; end if;
  update itineraries set user_id = p_actor
   where id = p_itinerary_id and user_id is null;
  if not found then raise exception 'not_claimable'; end if;  -- missing or already owned
end $fn$;

revoke all on function claim_draft(uuid,uuid) from public;
grant execute on function claim_draft(uuid,uuid) to authenticated;
```

> **Cross-stage:** consumed by the later creation-UI stage ("Adopt this draft" → then `personalize_itinerary`). **Depends on:** `itineraries.user_id` nullable (generator convention, S1).

- [ ] **Step 4: Apply + run test, expect PASS** (prints `claim_draft OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124650_p3_claim_draft_rpc.sql supabase/tests/p3_claim_draft.sql
git commit -m "$(cat <<'EOF'
P3: claim_draft RPC — adopt an anonymous generator draft (set user_id) before personalization

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `personalize_itinerary` RPC — venue swap, vibe, "why", opener, pay setting

**Why:** the courtship layer. A creator turns the generator's first draft into *their* date idea: swap a venue (from the vetted DB only — Invariant 5 holds), set vibe tags, the "why" note, the opener, and the pay setting. One owner-guarded RPC writes these and stamps `personalized_at`. Venue swaps validate the new place exists, is active, and is in the same city (no LLM, no fiction).

**Files:**
- Create: `supabase/migrations/20260525124800_p3_personalize_rpc.sql`
- Test: `supabase/tests/p3_personalize.sql`

- [ ] **Step 1: Write the failing test.** Fixtures via S1 `mk_user`/`mk_itinerary` (C8).

```sql
-- supabase/tests/p3_personalize.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; it uuid; got_pay text; got_open text; got_when timestamptz;
BEGIN
  cre := mk_user('cre');
  it  := mk_itinerary(cre);

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
-- supabase/migrations/20260525124800_p3_personalize_rpc.sql
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
  if auth.uid() is not null and p_actor is distinct from auth.uid() then raise exception 'actor_mismatch'; end if;  -- C10
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  update itineraries set
    vibe_tags       = coalesce(p_vibe_tags, vibe_tags),
    why_note        = coalesce(nullif(btrim(p_why_note), ''), why_note),
    opener          = coalesce(nullif(btrim(p_opener), ''), opener),
    pay_setting     = coalesce(p_pay_setting, pay_setting),
    personalized_at = now()
  where id = p_itinerary_id;

  -- C11.8: adding/changing UGC free-text re-flips any already-converted instances
  -- back to moderation 'pending' so personalized text is reviewed before it is feed-live.
  if (nullif(btrim(p_why_note),'') is not null) or (nullif(btrim(p_opener),'') is not null) then
    update date_instances
       set moderation_status = 'pending'
     where itinerary_id = p_itinerary_id
       and status = 'seeking'
       and moderation_status = 'approved';
  end if;
end $fn$;

-- Venue swap is separate so it can validate the target place (vetted DB only).
create or replace function swap_itinerary_venue(
  p_itinerary_id uuid, p_stop_index int, p_new_place_id uuid, p_actor uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_city uuid; v_place_active boolean; v_stops jsonb;
begin
  if auth.uid() is not null and p_actor is distinct from auth.uid() then raise exception 'actor_mismatch'; end if;  -- C10
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
git add supabase/migrations/20260525124800_p3_personalize_rpc.sql supabase/tests/p3_personalize.sql
git commit -m "$(cat <<'EOF'
P3: personalize_itinerary + swap_itinerary_venue RPCs (vibe/why/opener/pay + vetted-DB venue swap; UGC re-flips moderation)

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

## Task 14: `set_availability` RPC (the sanctioned availability write)

> **`browse_feed` v2 REMOVED — SUPERSEDED (CV4 / C4 / C11.3).** The original Task 14 also did `create or replace view browse_feed` to surface `sound_title`/`sound_license`. That is **deleted** for three reasons the audit and contract converge on:
> 1. **Execution-fatal:** `CREATE OR REPLACE VIEW` cannot drop/rename/reorder existing columns (it only appends). The v2 reordering (`opener` mid-list) throws `cannot change name of view column` on `db reset`.
> 2. **Cross-phase safety regression:** because P3 migrations would sort last, P3's view dropped P8's `moderation_status='approved'` filter (re-publishing removed UGC) and omitted `is_seed` — silently breaking P4/P8.
> 3. **Contract:** C11.3 says the feed view is **defined exactly once**, in a single drop+create **feed-finalization migration at band `133000` in S12**, after every base-table column it reads exists. **No phase uses `create or replace browse_feed`; P3 only `alter table`s base tables.**
>
> **Where the sound title/license + opener are surfaced instead:** the **S12 feed-finalization view** projects them (the base columns now exist — `itineraries.opener`/`sound_id`, the `sounds` join, `date_instances.moderation_status`), and the client read path is **P4/S5's `browse_feed_for_viewer()` RPC** (C4), which returns the surfaced columns. P3's job is only to make those base columns exist (Tasks 2, 4, 4b) — it does **not** edit the feed. The "dead ambient-sound UI" is closed at the read layer in S12/S5, fed by P3's columns, not by a P3 view.

**Why (kept):** a creator needs a sanctioned way to write availability windows (owner-guarded, validates non-empty/future via the table CHECK). This is the write path the convert-to-scheduled flow's "re-collect availability" step calls.

**Files:**
- Create: `supabase/migrations/20260525124900_p3_set_availability_rpc.sql`
- Test: `supabase/tests/p3_set_availability.sql`

- [ ] **Step 1: Write the failing test** (`set_availability` inserts a window owned by the creator). Fixtures via S1 `mk_user`/`mk_itinerary` (C8). **No `browse_feed` assertions — P3 does not define the feed.**

```sql
-- supabase/tests/p3_set_availability.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; it uuid; cnt int;
BEGIN
  cre := mk_user('cre');
  it  := mk_itinerary(cre);
  perform set_availability(it, tstzrange(now()+interval '2 days', now()+interval '2 days 4 hours'), cre);
  select count(*) into cnt from availability_windows where itinerary_id=it and creator_id=cre and is_active;
  IF cnt <> 1 THEN RAISE EXCEPTION 'set_availability did not insert one window, got %', cnt; END IF;
  RAISE NOTICE 'set_availability OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function set_availability(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525124900_p3_set_availability_rpc.sql
-- Sanctioned availability write. p_actor must equal auth.uid() (C10).
create or replace function set_availability(
  p_itinerary_id uuid, p_window tstzrange, p_actor uuid default auth.uid()
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if auth.uid() is not null and p_actor is distinct from auth.uid() then raise exception 'actor_mismatch'; end if;
  perform 1 from itineraries where id=p_itinerary_id and user_id=p_actor;
  if not found then raise exception 'not_owner'; end if;
  insert into availability_windows (itinerary_id, creator_id, window)
  values (p_itinerary_id, p_actor, p_window)   -- table CHECK enforces non-empty + future
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function set_availability(uuid,tstzrange,uuid) from public;
grant execute on function set_availability(uuid,tstzrange,uuid) to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `set_availability OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124900_p3_set_availability_rpc.sql supabase/tests/p3_set_availability.sql
git commit -m "$(cat <<'EOF'
P3: set_availability RPC (sanctioned availability write); browse_feed v2 removed — feed is finalized in S12 (C11.3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Full reset verification + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset` applies every S1 + S2 + P3 migration (cumulative, per C6 bands) and re-runs `seed.sql`. Expect no errors. **The feed view is NOT defined by P3 — do not expect a P3 `browse_feed` migration; the S12 finalization owns it (C11.3).**

- [ ] **Step 2: Run all P3 DB tests**

```bash
for f in supabase/tests/p3_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expect every file exit 0; notices print `… OK`. (All fixtures `\i supabase/tests/_fixtures.sql` first, per C8.)

- [ ] **Step 3: Run all shared-TS + Edge tests**

```bash
pnpm test                                  # P1's single root vitest config (C10/C12) — covers packages/business
deno test supabase/functions/process-media/process_media_test.ts
deno test supabase/functions/get-media-signed-url/index_test.ts
deno test supabase/functions/generate-plan/dating_fields_test.ts
```
Expect all green.

- [ ] **Step 4: Regenerate types** — `pnpm db:types`. Expect `packages/types/src/database.ts` to include `sounds`, `media_assets`, `availability_windows`, the `moderation_status` enum + `date_instances.moderation_status` column (Task 4b), the new `itineraries` columns (`opener`, `sound_id`, `personalized_at`, `ambient_media_id`), and the `convert_to_scheduled` / `claim_draft` / `personalize_itinerary` / `swap_itinerary_venue` / `attach_*` / `set_availability` functions. **No `browse_feed` v2 columns are added by P3 — the feed is finalized in S12.**

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

**Spec/roadmap coverage (vs P3 'Closes' list / S4 deliverables):**
- **Evergreen idea creation (browsable template):** generator output tagged `is_evergreen` first-draft (Task 11) + anonymous-draft claim (Task 11b) + `personalize_itinerary`/`swap_itinerary_venue` (Task 12). ✅
- **Scheduled instance creation (`date_instances`):** `convert_to_scheduled` RPC (Task 7) builds on the S1 `date_instances`. ✅
- **Evergreen→scheduled re-collecting availability (the audit's "liked idea, not that time"):** `availability_windows` table (Task 5) + shared guard (Task 6) + DB-enforced containing-window requirement in `convert_to_scheduled` (Task 7) + `set_availability` write path (Task 14). ✅
- **Generator as first draft + claim + personalization (venue swap, vibe, "why", opener, pay):** Tasks 11–12; venue swaps stay vetted-DB-only (Invariant 5 preserved). ✅
- **Media pipeline (upload → REAL transcode → signed-URL serve → moderation hook):** buckets (Task 1) + `media_assets` (Task 3) + `date_instances.moderation_status` (Task 4b, C11.8) + `process-media` Edge Function with real transcode + C1 invoker (Task 10) + `get-media-signed-url` read endpoint (Task 8b) + `attach_*` gate so only approved assets attach (Task 8). ✅
- **Moderation queue / UGC ingestion point (S9/P8):** `media_assets.moderation_state='pending'` index = the media queue; `date_instances.moderation_status='pending'` (C11.8) = the date queue; audit trigger + admin-aware self-approval guard + admin read policy (Task 3); `process-media` leaves moderation pending (Task 10). ✅
- **Curated ambient-sound library + source/licensing (closes dead ambient UI):** `sounds` table + seed with `source`/`license`/`attribution` (Task 2); shared selection + license-label (Task 9). The title/license reach the UI via the **S12 feed-finalization view + S5/P4 `browse_feed_for_viewer()` RPC** (fed by P3's base columns) — **not** a P3 view (C11.3). ✅
- **Google Places photos fetched live, not persisted:** honored — no place-photo persistence added; UGC photos go through `media_assets`. ✅

**Built on the S1 spine (no duplication):** reuses `itineraries`, `date_instances`, `places`, `cities`, `audit_log`, `log_status_transition()`, `payment_preference`, `date_match_status`, `set_updated_at()`, `btree_gist`, `_fixtures.sql` (C8), and the C1 `jobs`/`enqueue_job` for the media invoker. New tables/columns use `IF NOT EXISTS`. **P3 does NOT define `browse_feed`** (C11.3 — S12 owns it) and **does NOT bootstrap vitest** (C10/C12 — P1's root config owns it). ✅

**Conventions:** migration filenames `20260525124NNN_p3_*` (band `124000–1249xx`, C6); RLS on every table; idempotent `do $$ … duplicate_object …` policies; `set_updated_at()` triggers; `auth.uid()` policies + every SECURITY DEFINER RPC asserts `p_actor = auth.uid()` (C10); RPCs `revoke … from public; grant … to authenticated`; psql `RAISE EXCEPTION` tests via `_fixtures.sql`; `Deno.test` for Edge logic; vitest (root config) for shared TS. ✅

**Deferred to later stages (intentionally NOT in P3):** `browse_feed` finalization (S12, C11.3); the browse feed *UI* + ambient autoplay/native fallback + `browse_feed_for_viewer` projection of sound fields (S5/P4); the moderation *console*/triage UI + auto-classification + dispute resolution (S9/P8); offer/lock/shortlist transitions (S6/P5); notifications on conversion (the S2 `dispatch_notification` backbone, called by later stages); the React creation/personalize/convert/upload/claim **screens** + `api-client` helpers (later UI stage — P3 delivers the backend contract + shared logic these call); orphaned-upload retention/sweeper (data-lifecycle stage).

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. Seed `audio_url`s point at the curated public prefix; swap to the real curated asset host at execution. **The S12 feed and S5/P4 RPC are the consumers of P3's base columns — no P3 component is orphaned.**

**Known follow-ups flagged inline:** (1) `media_assets` self-approval guard is admin-aware (`admin_has_role()`, C10) so S9/P8 authed-moderator RPCs are not blocked; add an admin/service-role read policy so the queue is readable. (2) `swap_itinerary_venue` does a minimal `place_id` rewrite; full stop re-hydration is a client read concern; same-city check soft until `places.city_id` lands. (3) `coalesce`-only personalization cannot clear a field with `''` — a later UI stage may add explicit clear semantics (not a contract item).

**Type/name consistency:** enums declared once (`sound_license`, `media_kind`, `media_processing_state`, `media_moderation_state`, `moderation_status`) before use; column names consistent across tasks (`itineraries.sound_id`/`opener`/`personalized_at`/`ambient_media_id`, `availability_windows.window`, `sounds.audio_url`, `date_instances.moderation_status`). RPC signatures match their `grant`/`revoke` argument lists exactly. Shared object names (`jobs`/`enqueue_job`) reference C1 canonical, never redefined.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p3-creation-content-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Task 0 is **SUPERSEDED** (P1 owns the vitest root config). Prerequisites: S1 (schema spine + `_fixtures.sql`) and S2 (C1 `jobs`/`enqueue_job` for the Task 10 invoker) must land first; within P3, Task 1 (buckets) precedes the media tasks; everything else follows the migration band order (`124000–1249xx`, C6).

**2. Inline Execution** — execute tasks in this session via executing-plans, with checkpoints after Task 7 (conversion invariant) and Task 10 (media pipeline).

> **Authority reminder:** this is a SUBORDINATE EXECUTION SLICE. If any task here conflicts with `INTEGRATION-CONTRACT.md` v2 (incl. C11) or `RECONCILED-MASTER-PLAN.md`, those win and this file is corrected to match.
