SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P4 — Browse & Interest (Experience-First Feed) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Stage mapping:** This is the execution slice for **S5 — Browse & interest** in `RECONCILED-MASTER-PLAN.md` §8. P4 defines the feed's SHAPE (`browse_feed_for_viewer()` RPC + projection + pagination + future-only filter) and the swipe path. **P4 does NOT create the `browse_feed` view** — per Contract **C11.3**, the view is built exactly once in the **S12 feed-finalization migration at band `133000`** via `drop view if exists browse_feed; create view …` (after every base-table column it reads exists). P4 only references that finalization; it `alter table`s base tables but never `create or replace browse_feed`.
>
> **Canonical shared objects (reference, do not redefine):** `browse_feed` view (Contract C4 + **C11.3**, finalized in S12); the C2 `match_*` transition API + seed-night routing (owner P5/S6, **MD9**); the single root `vitest.config.ts` (owner P1, Contract **C10**); `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` (owner P0/S1, Contract **C8**); pay-setting labels (owner P10/S11, **CC5**).

**Goal:** Build the **blind, compatibility-pre-filtered** feed of open dates and the swipe-interest mechanic — the discovery surface of the experience-first loop. A browser sees the *night* (vibe, the "why", place photo, ambient sound, pay setting, neighborhood + coarse time window) and **never** the creator's identity, yet only sees nights from people who *could* be a mutual match (orientation, gender prefs, age range, distance). Swiping right/left writes idempotently to `swipes`. Ambient sound plays native-first with an explicit, graceful no-audio fallback on web. A concrete cold-start / empty-feed strategy carries a thin market.

**Architecture:** API-first. The feed query, the server-side compatibility pre-filter, and the swipe writes all live as a **SECURITY DEFINER RPC** (`browse_feed_for_viewer`) + a **swipe RPC** (`record_swipe`) in the database, fronted by typed helpers in `packages/api-client` so web today and native later call identical code (spec §10). The blind contract is enforced **in the database** (the `browse_feed` view — finalized in S12, Contract C11.3 — has no `creator_id`; the RPC selects only feed columns and applies the filter server-side, so a compatible-but-anonymous result set is all the client ever receives). The cold-start tiering and the "is this a hard match" predicate are pure functions in `packages/business`. Web renders a React Server Component feed page that fetches through `api-client`; the swipe action and ambient player are thin client components.

**Feed surfacing filter (canonical — Contract C11.3, mandatory in the RPC and the S12 view):** `browse_feed_for_viewer()` surfaces a `date_instances` row only when `status='seeking' AND starts_at > now() AND moderation_status='approved'` AND the creator profile has `account_state='active' AND standing NOT IN ('suspended','locked_ban')`. The `starts_at > now()` clause is what keeps stale/past-dated nights (including expired seed nights) out of the feed. (`moderation_status` is owned by P3/S4; `account_state`/`standing` by P9/P7. P4 reads them; it does not create them.)

**Tech Stack:** Supabase Postgres + PostGIS (distance via `ST_DWithin` on `geography`), SQL migrations (`supabase/migrations/`), RLS + SECURITY DEFINER RPCs, psql invariant/leak tests (`supabase/tests/`), `packages/api-client` + `packages/business` + `packages/validators` (TS), vitest for TS unit tests, Next.js App Router (`apps/web/app/feed`) + the existing `createClient()` server helper. No new notification or chat surface (P2/P6).

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§5 browsing, §4 pre-lock privacy, §10 native-first); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 4); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (`browse_feed`, `swipes`, `date_instances`, `cities`, `profiles` dating columns).

**Depends on (must land first):**
- **P0 / S1** — `cities` (with `centroid geography(Point,4326)`), `date_instances` (`creator_id`, `city_id`, `venue_id`, `status='seeking'`, `time_range`), `swipes` (unique `(swiper_id, date_instance_id)` + blind RLS), `profiles` dating columns. PostGIS + `btree_gist` enabled. **`itineraries.vibe_tags text[]`** (Contract C7, owner P0). **Shared test fixtures `_fixtures.sql`** with `mk_user`/`mk_itinerary`/`mk_instance` (Contract C8, owner P0) — every P4 psql test `\i`'s this; no P4 test inserts bare into `profiles`/`itineraries`/`date_instances`.
- **P1 / S3** — preference fields populated on `profiles`: `gender`, `gender_preferences text[]`, `age` / `age_pref int4range`, `distance_pref_km`, `primary_city_id`, `dating_enabled`, `verification`. (P0 created the columns; P1 owns onboarding that fills them.) The pre-filter reads these. **Also owns the single root `vitest.config.ts`** (Contract C10) — P4 does not create or bootstrap vitest.
- **P3 / S4** — *some* content exists (`date_instances` with `status='seeking'`); **`moderation_status` enum + column on `date_instances`** (Contract C11.8, owner P3 — default `'approved'` for non-UGC, `'pending'` when UGC attached; the feed filters `moderation_status='approved'`); **sound fields** (`sound_title`, `sound_license`, and the ambient audio URL) on the surfaced row (Contract C4 — feed projects these). P4 can ship with library-only audio.
- **P7 / S8** — `profiles.standing standing_state` (Contract C3) — the feed filter excludes `standing IN ('suspended','locked_ban')`. P4 reads it; P7 owns the ladder that writes it.
- **P9 / S10** — `profiles.account_state account_lifecycle` (Contract C3/C11.5) — the feed filter requires `account_state='active'` (paused/deletion_pending/deleted creators drop out of the feed, Contract C11.3/C11.9). P4 reads it; P9 owns it.
- **P5 / S6 (cross-stage seam — MD9):** the seed-night (concierge) right-swipe consumer. P4 records the swipe and shows the real "you're in line" confirmation UI; the actual concierge match resolution is the C2 match loop (owner P5/S6). **Depends on P5/MD9** for the resolution path. The "you're in line" UX must be real (no dead-end) and P5 must accept the seeded interest.
- **S12 finalization (Contract C11.3):** the single `browse_feed` view at band `133000`. P4 references it; P4 does **not** create it. Earlier-stage tests that need a feed query against the *view* either query base tables or rely on the RPC (which P4 owns).

**Closes (audit):** "blind but pre-filtered" (filter quality = trust dependency); "empty feed at launch / cold-start"; RLS identity-leak risk (test that the feed never returns creator identity); dead ambient-on-web (explicit fallback); **stale/past-dated nights surfacing** (the `starts_at > now()` filter); **20-night hard cap** (real keyset pagination + `loadMore`, audit B4); **seed-night dead-end** (real "you're in line" UI wired to P5/MD9, audit C1).

**Conventions (follow exactly — mirrors P0):**
- Migration filenames `YYYYMMDDHHMMSS_snake_description.sql`; this phase uses the **P4 band `20260525125000`–`20260525125999`** per Contract **C6** (the previous `1300xx` band collided with P9's `130000` band — corrected). The `browse_feed` view itself is **not** created in P4's band; it is the S12 finalization migration at `20260525133000` (Contract C11.3).
- Enable RLS on every new table; create policies idempotently with `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
- `auth.uid()` in policies and RPC bodies; SECURITY DEFINER functions pin `set search_path = public`.
- All loop logic in shared packages, never web-only (spec §10). Web is a thin RSC over `api-client`.
- psql tests are `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior → clean exit = PASS. TS tests are vitest.

**Local test loop:**
- SQL: `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`.
- TS: `pnpm --filter @after5/business test` / `pnpm --filter @after5/api-client test` (vitest; Task 1 wires the runner if absent).

---

## File Structure

```
supabase/
  migrations/
    20260525125000_p4_date_instance_geo.sql        # geo point on date_instances + backfill + feed-distance index
    20260525125100_p4_is_seed_column.sql            # is_seed boolean on date_instances (base-table alter only; NO view)
    20260525125200_p4_browse_feed_rpc.sql           # browse_feed_for_viewer() SECURITY DEFINER pre-filter RPC (owns feed SHAPE)
    20260525125300_p4_record_swipe_rpc.sql          # record_swipe() idempotent swipe RPC
    20260525125400_p4_feed_seed.sql                 # cold-start seed flag + curated fallback content seed (Kelowna)
  tests/
    p4_feed_no_identity_leak.sql                    # THE leak test: RPC never returns creator identity (behavioral + structural)
    p4_compat_prefilter.sql                         # orientation/gender/age/distance/future-only filtering correctness
    p4_record_swipe_idempotent.sql                  # one swipe per swiper/instance; re-swipe updates, never duplicates
    p4_cold_start.sql                               # empty real feed → curated fallback rows surface
packages/
  validators/src/feed.ts                            # FeedCard, FeedQuery, SwipeInput zod schemas + exports in index.ts
  business/src/compat.ts                             # pure isHardCompatible() + cold-start tier selection
  business/src/compat.test.ts                        # vitest (uses P1's root vitest config — NOT created here)
  api-client/src/feed.ts                              # browseFeed(), recordSwipe() typed helpers
  api-client/src/feed.test.ts                         # vitest (mocked client) — shape + blind contract assertions
  api-client/src/index.ts                             # re-export feed helpers
apps/web/
  app/feed/page.tsx                                  # RSC feed page (fetches via api-client)
  app/feed/EmptyFeedState.tsx                         # cold-start / exhausted-feed empty state
  app/feed/SeedConfirm.tsx                            # "you're in line" confirmation after a seed-night right-swipe (MD9)
  app/api/feed/swipe/route.ts                          # thin POST → record_swipe RPC
  app/api/feed/route.ts                                # thin GET → browse_feed_for_viewer (pagination loadMore endpoint, B4)
  components/feed/FeedCard.tsx                          # one blind night card (client)
  components/feed/AmbientPlayer.tsx                     # native-first audio w/ explicit web fallback
  components/feed/SwipeDeck.tsx                          # client deck: swipe right/left → /api/feed/swipe; keyset loadMore
```

**Removed vs the original draft:** the `20260525130100_p4_browse_feed_geo.sql` view-creation migration is **deleted** — P4 must not `create or replace browse_feed` (Contract C4/C11.3). The view's single definition is the S12 finalization at band `133000`. P4 owns the feed SHAPE via the RPC only. The standalone `is_seed` column add is split into its own base-table `alter table` migration (allowed — phases may `alter` base tables).

No production secrets touched. Types regenerate via `pnpm db:types` after SQL lands (Task 9). The root `vitest.config.ts` is owned by P1 (Contract C10); P4 assumes `pnpm test` works and creates no vitest setup.

---

## Task 1: Feed validators (shared contract)

Define the **single source of truth** for the feed card shape and swipe input. The card schema is the enforcement boundary: it has **no creator-identity field**, so any helper returning it is structurally blind.

> **Vitest is NOT bootstrapped here.** Per Contract **C10**, P1 owns the single root `vitest.config.ts` (workspace globs covering `apps/web` + `packages/*`). P4 assumes `pnpm test` works and references it. If P1 has not landed when this slice runs, that is a missing dependency to resolve in P1 — **do not create a competing vitest config in P4**.

**Files:**
- Create: `packages/validators/src/feed.ts`
- Modify: `packages/validators/src/index.ts`, `packages/validators/package.json`
- Create: `packages/validators/src/feed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/validators/src/feed.test.ts
import { describe, it, expect } from 'vitest';
import { FeedCardSchema, FeedQuerySchema, SwipeInputSchema } from './feed';

describe('feed contract', () => {
  it('FeedCard has NO creator-identity fields (blind contract)', () => {
    const keys = Object.keys(FeedCardSchema.shape);
    for (const banned of ['creator_id', 'creator_name', 'creator_photo', 'full_name', 'name', 'email', 'phone']) {
      expect(keys).not.toContain(banned);
    }
  });
  it('FeedCard parses a valid blind card', () => {
    const card = FeedCardSchema.parse({
      date_instance_id: '00000000-0000-0000-0000-000000000001',
      city_id: '00000000-0000-0000-0000-000000000002',
      itinerary_id: '00000000-0000-0000-0000-000000000003',
      time_window_start: '2026-06-01T19:00:00.000Z',
      venue_neighborhood: 'Downtown',
      vibe_tags: ['romantic'],
      why_note: 'sunset wine on the lake',
      sound_title: 'Lakeside evening',
      sound_license: 'CC-BY-4.0',
      ambient_sound_url: 'https://cdn.example/amb/lake.mp3',
      pay_setting: 'split',
      distance_m: 4200,
      is_seed: false,
    });
    expect(card.venue_neighborhood).toBe('Downtown');
  });
  it('SwipeInput rejects bad direction', () => {
    expect(() => SwipeInputSchema.parse({ date_instance_id: 'x', direction: 'up' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm --filter @after5/validators test` → cannot find `./feed`. (Vitest is provided by P1's root config — Contract C10. If `pnpm test` does not resolve, that is a P1 dependency gap; resolve it in P1, never by adding a P4-local vitest config.)

- [ ] **Step 3: Write the real code**

```ts
// packages/validators/src/feed.ts
import { z } from 'zod';

// The blind feed card. INTENTIONALLY contains no creator identity. This schema
// is the contract boundary: api-client returns exactly this, so the client is
// structurally incapable of seeing who made the night. (spec §5, §4 privacy)
// Surfaced columns are the Contract C4 projection (identity-stripped) + distance_m:
//   date_instance_id, city_id, itinerary_id, time_window_start (hour-truncated),
//   pay_setting, vibe_tags, why_note, sound_title, sound_license, venue_neighborhood,
//   is_seed, distance_m.
export const FeedCardSchema = z.object({
  date_instance_id: z.string().uuid(),
  city_id: z.string().uuid(),
  itinerary_id: z.string().uuid(),
  time_window_start: z.string().datetime({ offset: true }), // coarse (hour-truncated); allow tz offsets from timestamptz
  venue_neighborhood: z.string().nullable(),      // neighborhood only, never venue name
  vibe_tags: z.array(z.string()).default([]),
  why_note: z.string().nullable(),
  sound_title: z.string().nullable(),             // P3 sound fields (Contract C4)
  sound_license: z.string().nullable(),
  ambient_sound_url: z.string().url().nullable(), // playable URL minted by P3 media pipeline
  pay_setting: z.enum(['i_pay', 'they_pay', 'split']).nullable(),
  distance_m: z.number().nonnegative().nullable(), // viewer↔venue, from PostGIS
  is_seed: z.boolean().default(false),             // cold-start curated fallback marker
});
export type FeedCard = z.infer<typeof FeedCardSchema>;

// Keyset cursor: (is_seed, date_instance_id) composite — matches the RPC ORDER BY
// (real nights before seed). A bare id cursor would skip rows because is_seed is the
// primary sort key (audit B4). Encoded opaquely; null = first page.
export const FeedQuerySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z
    .object({ is_seed: z.boolean(), date_instance_id: z.string().uuid() })
    .nullable()
    .default(null),
});
export type FeedQuery = z.infer<typeof FeedQuerySchema>;

export const SwipeInputSchema = z.object({
  date_instance_id: z.string().uuid(),
  direction: z.enum(['right', 'left']),
});
export type SwipeInput = z.infer<typeof SwipeInputSchema>;
```

Append to `packages/validators/src/index.ts`:
```ts
export * from './feed';
```

- [ ] **Step 4: Run it, expect PASS** — `pnpm --filter @after5/validators test`.

- [ ] **Step 5: Commit**

```bash
git add packages/validators/src/feed.ts packages/validators/src/index.ts packages/validators/package.json
git add packages/validators/src/feed.test.ts
git commit -m "P4: feed/swipe zod contract (blind card has no creator identity)"
```

---

## Task 2: Geo point on `date_instances` (real per-venue distance)

P0's `cities.centroid` is `geography`, but `places` carries `lat`/`lng` decimals and `date_instances` has no geo column — so a real per-venue distance filter has nothing to query. Add a `geo geography(Point,4326)` to `date_instances`, populate it on insert (venue point, falling back to city centroid), and index it for `ST_DWithin`.

**Files:**
- Create: `supabase/migrations/20260525125000_p4_date_instance_geo.sql`
- Test: `supabase/tests/p4_compat_prefilter.sql` (created here, asserts column + index; filtering logic asserted in Task 4)

- [ ] **Step 1: Write the failing test (structural slice)**

```sql
-- supabase/tests/p4_compat_prefilter.sql  (structural assertions; behavioral block appended in Task 4)
\i supabase/tests/_fixtures.sql   -- shared mk_user/mk_itinerary/mk_instance (Contract C8, owner P0)
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='date_instances' AND column_name='geo';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances.geo missing'; END IF;
  PERFORM 1 FROM pg_indexes
   WHERE tablename='date_instances' AND indexdef ILIKE '%gist%geo%';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances geo GiST index missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `column ... geo ... missing`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525125000_p4_date_instance_geo.sql
-- Real per-venue geography for the distance pre-filter. Venue point when known,
-- else the city centroid so every seeking instance is still distance-rankable.
alter table date_instances
  add column if not exists geo geography(Point, 4326);

create or replace function set_date_instance_geo() returns trigger
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_lat numeric; v_lng numeric; v_centroid geography;
begin
  if new.venue_id is not null then
    select lat, lng into v_lat, v_lng from places where id = new.venue_id;
  end if;
  if v_lat is not null and v_lng is not null then
    new.geo := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;
  else
    select centroid into v_centroid from cities where id = new.city_id;
    new.geo := v_centroid;  -- may be null if city has no centroid; filter tolerates null
  end if;
  return new;
end $fn$;

create trigger date_instances_set_geo
  before insert or update of venue_id, city_id on date_instances
  for each row execute function set_date_instance_geo();

-- Backfill any rows created before this trigger existed.
update date_instances di set geo = coalesce(
  (select ST_SetSRID(ST_MakePoint(p.lng, p.lat),4326)::geography
     from places p where p.id = di.venue_id and p.lat is not null and p.lng is not null),
  (select c.centroid from cities c where c.id = di.city_id)
) where di.geo is null;

create index if not exists date_instances_geo_gist on date_instances using gist (geo);
```

- [ ] **Step 4: Apply + run test, expect PASS** — `supabase db reset && psql … -f supabase/tests/p4_compat_prefilter.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525125000_p4_date_instance_geo.sql supabase/tests/p4_compat_prefilter.sql
git commit -m "P4: date_instances.geo (venue point w/ city-centroid fallback) + GiST index"
```

---

## Task 3: Add `is_seed` to `date_instances` (base-table alter only — NO view)

> **SUPERSEDED (Contract C4/C11.3):** the original Task 3 created/`create or replace`d the `browse_feed` view. **P4 must NOT touch the view.** The `browse_feed` view is defined exactly once in the **S12 feed-finalization migration at band `133000`** via `drop view if exists browse_feed; create view …`, after every base-table column it reads exists (`moderation_status` P3, `is_seed` P4, `account_state`/`standing` P7/P9). Per Contract C4: *"No other phase may `create or replace` it; other phases only `alter table` the base tables."* This task is reduced to the one base-table column P4 legitimately owns — `is_seed`.

This task adds the `is_seed` boolean to `date_instances` so the cold-start concierge nights (Task 7) are markable and the feed can order real nights before seeds. Raw `geo` is deliberately never exposed to the client (anti-triangulation, spec §4); distance is computed inside the SECURITY DEFINER RPC (Task 4). The feed SHAPE — what columns surface — is owned by the RPC (Task 4) and by the S12 view definition, which must project the same Contract C4 columns (`date_instance_id, city_id, time_window_start, itinerary_id, pay_setting, vibe_tags, why_note, sound_title, sound_license, venue_neighborhood, is_seed`).

**Files:**
- Create: `supabase/migrations/20260525125100_p4_is_seed_column.sql`
- (Leak test lives in Task 5; the view itself is the S12 finalization, not P4.)

- [ ] **Step 1: Write the migration (base-table column only)**

```sql
-- supabase/migrations/20260525125100_p4_is_seed_column.sql
-- P4 owns the is_seed marker on date_instances (cold-start concierge nights).
-- This is a base-table alter ONLY. P4 does NOT create or replace browse_feed —
-- the view is the S12 finalization migration at band 133000 (Contract C11.3),
-- which projects is_seed alongside moderation_status, sound fields, vibe_tags, etc.
alter table date_instances
  add column if not exists is_seed boolean not null default false;
```

- [ ] **Step 2: Apply, expect clean** — `supabase db reset`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525125100_p4_is_seed_column.sql
git commit -m "P4: add date_instances.is_seed (base-table alter; browse_feed view owned by S12)"
```

---

## Task 4: `browse_feed_for_viewer()` — server-side compatibility pre-filter

The heart of "blind ≠ unfiltered" (spec §5). A SECURITY DEFINER RPC that, for the calling viewer, returns blind feed cards **only** for instances whose creator is **mutually basic-compatible** — orientation/gender, age range, and PostGIS distance — without ever returning who the creator is. Mutuality is enforced both directions: the viewer's prefs must accept the creator AND the creator's prefs must accept the viewer (the night should only reach people the creator could match).

**Files:**
- Create: `supabase/migrations/20260525125200_p4_browse_feed_rpc.sql`
- Test: append behavioral block to `supabase/tests/p4_compat_prefilter.sql`

> **Fixtures (Contract C8):** the shared `mk_user`/`mk_itinerary`/`mk_instance` live in `supabase/tests/_fixtures.sql` (owner P0). The shared `mk_instance(p_itin uuid, p_creator uuid, p_starts timestamptz)` does not set `geo`/prefs, so this test defines a **P4-local geo helper with a distinct name** (`mk_geo_instance`) — it does **not** redefine the shared `mk_instance` (no clobbering the C8 fixture). Profiles/users are created via `mk_user` from `_fixtures.sql`, then prefs are `update`d (no bare `insert into profiles`).

- [ ] **Step 1: Write the failing test (append behavioral block)**

```sql
-- supabase/tests/p4_compat_prefilter.sql  (append after the structural block from Task 2)
-- P4-local geo helper (distinct name; does NOT redefine the shared C8 mk_instance):
create or replace function mk_geo_instance(p_cre uuid, p_city uuid, p_lng numeric, p_lat numeric)
returns uuid language plpgsql as $$
declare it uuid; di uuid; begin
  insert into itineraries (id,user_id,pay_setting,vibe_tags,why_note)
    values (gen_random_uuid(), p_cre, 'split', '{romantic}', 'why') returning id into it;
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,status,geo)  -- moderation_status defaults 'approved' (P3)
    values (it, p_cre, p_city, now()+interval '2 days','seeking',
            ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography) returning id into di;
  return di;
end $$;
DO $$
DECLARE
  viewer uuid; far_cre uuid; near_ok uuid; wrong_gender uuid; out_of_age uuid; past_cre uuid;
  cid uuid; n int;
BEGIN
  insert into cities (slug,name,timezone,centroid,is_active) values
    ('pftest','pftest','UTC', ST_SetSRID(ST_MakePoint(-119.4960,49.8880),4326)::geography, true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='pftest';

  -- All actors created via mk_user (Contract C8 — seeds auth.users + profiles), then prefs updated.
  viewer := mk_user('viewer');
  near_ok := mk_user('near'); wrong_gender := mk_user('wg');
  out_of_age := mk_user('oa'); far_cre := mk_user('far'); past_cre := mk_user('past');

  -- viewer: man, into women, 28, wants 25-35, 40km radius, in pftest centroid
  update profiles set gender='man', gender_preferences='{woman}', age=28, age_pref='[25,35]',
    distance_pref_km=40, primary_city_id=cid, dating_enabled=true, verification='verified',
    account_state='active', standing='good' where id=viewer;
  -- near_ok: woman into men, 30, wants 26-32, same city → COMPATIBLE
  update profiles set gender='woman', gender_preferences='{man}', age=30, age_pref='[26,32]',
    distance_pref_km=40, primary_city_id=cid, dating_enabled=true, verification='verified',
    account_state='active', standing='good' where id=near_ok;
  -- wrong_gender: man into men → mutual gender fails
  update profiles set gender='man', gender_preferences='{man}', age=30, age_pref='[26,32]',
    distance_pref_km=40, primary_city_id=cid, dating_enabled=true, verification='verified',
    account_state='active', standing='good' where id=wrong_gender;
  -- out_of_age: woman into men but age 50, outside viewer's 25-35
  update profiles set gender='woman', gender_preferences='{man}', age=50, age_pref='[26,40]',
    distance_pref_km=40, primary_city_id=cid, dating_enabled=true, verification='verified',
    account_state='active', standing='good' where id=out_of_age;
  -- far_cre: woman into men, 30, but ~3000km away → outside distance
  update profiles set gender='woman', gender_preferences='{man}', age=30, age_pref='[26,32]',
    distance_pref_km=40, primary_city_id=cid, dating_enabled=true, verification='verified',
    account_state='active', standing='good' where id=far_cre;
  -- past_cre: perfectly compatible woman, BUT her night is in the past → must be filtered (starts_at>now())
  update profiles set gender='woman', gender_preferences='{man}', age=30, age_pref='[26,32]',
    distance_pref_km=40, primary_city_id=cid, dating_enabled=true, verification='verified',
    account_state='active', standing='good' where id=past_cre;

  -- one seeking instance per creator; near & wrong & out_of_age at centroid, far_cre far away
  PERFORM mk_geo_instance(near_ok, cid, -119.4960, 49.8880);
  PERFORM mk_geo_instance(wrong_gender, cid, -119.4960, 49.8880);
  PERFORM mk_geo_instance(out_of_age, cid, -119.4960, 49.8880);
  PERFORM mk_geo_instance(far_cre, cid, -106.0000, 52.0000);
  -- compatible but PAST-dated night (force starts_at into the past after insert)
  PERFORM mk_geo_instance(past_cre, cid, -119.4960, 49.8880);
  update date_instances set starts_at = now() - interval '1 day' where creator_id = past_cre;

  -- Call the RPC as the viewer (set local request.jwt claim to the viewer uuid)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer::text)::text, true);
  select count(*) into n from browse_feed_for_viewer(20, null, null);

  -- Only near_ok should pass all filters (wrong gender / age / distance / past-dated all excluded).
  IF n <> 1 THEN RAISE EXCEPTION 'pre-filter returned % rows, expected exactly 1 (near_ok only)', n; END IF;
  RAISE NOTICE 'compat pre-filter OK (future-only + mutual compat)';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `function browse_feed_for_viewer(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525125200_p4_browse_feed_rpc.sql

-- Let an explicitly-provided geo survive (used by tests + future precise-venue inserts).
-- NOTE: P4 owns the set_date_instance_geo trigger behavior. P3's convert_to_scheduled
-- inserts date_instances; the trigger is shared but its final behavior is documented
-- here as P4's (audit C3 — single documented owner).
create or replace function set_date_instance_geo() returns trigger
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_lat numeric; v_lng numeric; v_centroid geography;
begin
  if new.geo is not null then return new; end if;             -- respect explicit geo
  if new.venue_id is not null then
    select lat, lng into v_lat, v_lng from places where id = new.venue_id;
  end if;
  if v_lat is not null and v_lng is not null then
    new.geo := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;
  else
    select centroid into v_centroid from cities where id = new.city_id;
    new.geo := v_centroid;
  end if;
  return new;
end $fn$;

-- Mutual-compatibility blind feed. SECURITY DEFINER so it can read creator prefs
-- to compute the filter, while returning ONLY the Contract C4 blind columns (+ distance).
-- The surfacing filter is the canonical Contract C11.3 filter (status=seeking AND
-- starts_at>now() AND moderation_status='approved' AND creator account_state='active'
-- AND creator standing NOT IN ('suspended','locked_ban')). The S12 browse_feed view
-- applies the same filter; this RPC is the personalized (per-viewer) reader of that shape.
create or replace function browse_feed_for_viewer(
  p_limit int default 20,
  p_cursor_is_seed boolean default null,
  p_cursor_id uuid default null
)
returns table (
  date_instance_id uuid,
  city_id uuid,
  itinerary_id uuid,
  time_window_start timestamptz,
  venue_neighborhood text,
  vibe_tags text[],
  why_note text,
  sound_title text,
  sound_license text,
  ambient_sound_url text,
  pay_setting payment_preference,
  distance_m double precision,
  is_seed boolean
)
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_id uuid := auth.uid(); v_geo geography; v_radius int;
declare v_age int; v_age_pref int4range; v_gender text; v_gender_prefs text[];
begin
  if v_id is null then return; end if;  -- anon gets nothing from the personalized feed
  select coalesce(c.centroid, null), p.distance_pref_km, p.age, p.age_pref, p.gender, p.gender_preferences
    into v_geo, v_radius, v_age, v_age_pref, v_gender, v_gender_prefs
    from profiles p left join cities c on c.id = p.primary_city_id
   where p.id = v_id;
  v_radius := coalesce(v_radius, 40);

  return query
  select di.id, di.city_id, di.itinerary_id, date_trunc('hour', di.starts_at),
         pl.neighborhood, i.vibe_tags, i.why_note, i.sound_title, i.sound_license,
         i.ambient_sound_url, i.pay_setting,
         case when v_geo is null then null else ST_Distance(di.geo, v_geo) end,
         di.is_seed
  from date_instances di
  join itineraries i on i.id = di.itinerary_id
  join profiles cp   on cp.id = di.creator_id     -- creator prefs/state (NOT returned)
  left join places pl on pl.id = di.venue_id
  -- CANONICAL SURFACING FILTER (Contract C11.3 — identical to the S12 view):
  where di.status = 'seeking'
    and di.starts_at > now()                                     -- future-only (audit B4/§4): no stale/past nights
    and di.moderation_status = 'approved'                        -- P3-owned column
    and cp.account_state = 'active'                              -- P9-owned: paused/deleting creators drop out
    and cp.standing not in ('suspended','locked_ban')            -- P7-owned: moderation gate
    and di.creator_id <> v_id                                    -- never your own nights
    and cp.dating_enabled = true
    -- DISTANCE: within the viewer's radius (skip when either side lacks geo)
    and (v_geo is null or di.geo is null
         or ST_DWithin(di.geo, v_geo, v_radius * 1000))
    -- GENDER mutuality: viewer wants creator's gender AND creator wants viewer's gender
    and (array_length(v_gender_prefs,1) is null or cp.gender = any(v_gender_prefs))
    and (array_length(cp.gender_preferences,1) is null or v_gender = any(cp.gender_preferences))
    -- AGE mutuality: creator age in viewer's range AND viewer age in creator's range
    and (v_age_pref is null or cp.age is null or cp.age <@ v_age_pref)
    and (cp.age_pref is null or v_age is null or v_age <@ cp.age_pref)
    -- BLOCKS: neither party has blocked the other
    and not exists (
      select 1 from blocks b
       where (b.blocker_id = v_id and b.blocked_id = di.creator_id)
          or (b.blocker_id = di.creator_id and b.blocked_id = v_id))
    -- ALREADY SWIPED: don't re-show
    and not exists (
      select 1 from swipes s where s.swiper_id = v_id and s.date_instance_id = di.id)
    -- KEYSET CURSOR matching the (is_seed, id) ORDER BY (audit B4): real nights
    -- before seeds, then by id. A bare id cursor would skip rows because is_seed is
    -- the primary sort key. Composite row-comparison advances correctly across pages.
    and (p_cursor_id is null
         or (di.is_seed, di.id) > (p_cursor_is_seed, p_cursor_id))
  order by di.is_seed asc, di.id asc      -- real nights before seed/curated fallback
  limit greatest(1, least(p_limit, 50));
end $fn$;

revoke all on function browse_feed_for_viewer(int, boolean, uuid) from public;
grant execute on function browse_feed_for_viewer(int, boolean, uuid) to authenticated;
```

> **Decision — mutual filter:** a hard filter both ways. If the viewer has *empty* `gender_preferences`/`age_pref` (not yet onboarded that field) the clause is permissive (`array_length(...) is null` → true) so the feed isn't accidentally empty; **P1 owns making orientation/age prefs required at onboarding** (cross-stage dependency — flagged below). Orientation is modeled via `gender` + `gender_preferences` (P0/P1 fields) rather than a separate `orientation` enum.
> **Decision — distance:** `ST_DWithin(geo, viewer_centroid, radius_m)`. Distance is measured venue→viewer-city-centroid (viewer's precise location isn't stored server-side pre-native). When native ships precise location it can pass a viewer point; the RPC signature can gain an optional param later without breaking callers. The client renders distance as a **coarse label** (see Task 9/audit B5), not a false "4.2 km away" precision claim.
> **Decision — future-only (Contract C11.3, audit B4/lifecycle):** `starts_at > now()` is mandatory. Without it, expired seed nights and any past `seeking` instance surface forever. Re-rolling/expiring stale seed nights is a job owned by P2/P5 (not P4); P4's filter simply never shows them.
> **Decision — keyset cursor (audit B4):** the cursor is the composite `(is_seed, date_instance_id)` of the last row on the previous page, compared with row-comparison `>` matching the `ORDER BY is_seed asc, id asc`. This is the fix for the original inert `id > cursor` keyset that skipped rows.

- [ ] **Step 4: Apply + run test, expect PASS** — prints `compat pre-filter OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525125200_p4_browse_feed_rpc.sql supabase/tests/p4_compat_prefilter.sql
git commit -m "P4: browse_feed_for_viewer() blind mutual pre-filter + future-only + account/standing filter + keyset"
```

---

## Task 5: The identity-leak test (the trust-critical assertion)

A dedicated test proving the blind contract. The **primary** assertion is **behavioral** (audit B3 — structural string-matching gives false assurance): insert a creator with known PII (`first_name`, photo URL, venue name), call the RPC as a viewer, and assert no returned text field equals that PII. Structural checks (return-signature column names, no `creator_id`/venue `name` in the body) are kept as belt-and-suspenders, **not** as the sole guard.

> **View scope:** the `browse_feed` *view*'s no-identity assertion runs against the **S12 finalization** (the view does not exist in P4 isolation — Contract C11.3). The view-column check below is guarded with an existence test so this file passes in P4 isolation (RPC-only) and tightens once S12's view lands. The RPC behavioral + structural checks are the P4 launch-gate.

**Files:**
- Create: `supabase/tests/p4_feed_no_identity_leak.sql`

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/p4_feed_no_identity_leak.sql
\i supabase/tests/_fixtures.sql   -- shared mk_user (Contract C8)
-- (A) BEHAVIORAL leak test (primary): real PII must never appear in any returned text field.
DO $$
DECLARE
  viewer uuid; creator uuid; cid uuid; r record;
  k_name text := 'SECRET_CREATOR_NAME'; k_venue text := 'SECRET_VENUE_NAME';
  it uuid;
BEGIN
  insert into cities (slug,name,timezone,centroid,is_active) values
    ('leaktest','leaktest','UTC', ST_SetSRID(ST_MakePoint(-119.4960,49.8880),4326)::geography, true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='leaktest';

  viewer := mk_user('viewerL'); creator := mk_user('creatorL');
  update profiles set gender='man', gender_preferences='{woman}', age=28, age_pref='[18,99]',
    distance_pref_km=500, primary_city_id=cid, dating_enabled=true, verification='verified',
    account_state='active', standing='good' where id=viewer;
  -- Give the creator a known, distinctive name to detect any leak of identity text.
  update profiles set first_name=k_name, gender='woman', gender_preferences='{man}', age=30,
    age_pref='[18,99]', distance_pref_km=500, primary_city_id=cid, dating_enabled=true,
    verification='verified', account_state='active', standing='good' where id=creator;
  insert into places (id, city_id, name, neighborhood, lat, lng)
    values (gen_random_uuid(), cid, k_venue, 'Downtown', 49.8880, -119.4960);
  insert into itineraries (id,user_id,pay_setting,vibe_tags,why_note)
    values (gen_random_uuid(), creator, 'split', '{romantic}', 'why') returning id into it;
  insert into date_instances (itinerary_id,creator_id,city_id,venue_id,starts_at,status)
    select it, creator, cid, p.id, now()+interval '2 days','seeking'
    from places p where p.name=k_venue and p.city_id=cid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer::text)::text, true);
  FOR r IN SELECT * FROM browse_feed_for_viewer(20, null, null) LOOP
    -- date_instance_id/city_id/itinerary_id are non-PII uuids; assert no text field carries identity.
    IF k_name = ANY (ARRAY[r.venue_neighborhood, r.why_note, r.sound_title, r.sound_license])
       OR k_venue = ANY (ARRAY[r.venue_neighborhood, r.why_note, r.sound_title, r.sound_license])
    THEN RAISE EXCEPTION 'LEAK: a returned field exposed creator name or venue name'; END IF;
  END LOOP;
  RAISE NOTICE 'behavioral no-identity-leak OK';
  ROLLBACK;
END $$;

-- (B) STRUCTURAL guards (belt-and-suspenders, not the sole assurance).
DO $$
DECLARE banned text; v_exists boolean;
BEGIN
  -- (B1) The RPC return signature must not expose identity (proargnames includes OUT names for RETURNS TABLE).
  FOR banned IN SELECT unnest(ARRAY['creator_id','user_id','first_name','full_name','email','phone','clear_photo_url']) LOOP
    PERFORM 1
      FROM pg_proc pr, unnest(pr.proargnames) AS argname
     WHERE pr.proname = 'browse_feed_for_viewer' AND argname = banned;
    IF FOUND THEN RAISE EXCEPTION 'LEAK: browse_feed_for_viewer returns/takes %', banned; END IF;
  END LOOP;

  -- (B2) Body must not select identity/venue-name columns into the output.
  PERFORM 1 FROM pg_proc
   WHERE proname='browse_feed_for_viewer'
     AND (prosrc ILIKE '%di.creator_id,%' OR prosrc ILIKE '%cp.first_name%'
          OR prosrc ILIKE '%pl.name%' OR prosrc ILIKE '%clear_photo_url%');
  IF FOUND THEN RAISE EXCEPTION 'LEAK: browse_feed_for_viewer body references an identity/venue-name column'; END IF;

  -- (B3) IF the S12 browse_feed view exists, it too must expose no identity column.
  SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name='browse_feed') INTO v_exists;
  IF v_exists THEN
    FOR banned IN SELECT unnest(ARRAY['creator_id','user_id','first_name','full_name','email','phone','clear_photo_url']) LOOP
      PERFORM 1 FROM information_schema.columns WHERE table_name='browse_feed' AND column_name=banned;
      IF FOUND THEN RAISE EXCEPTION 'LEAK: browse_feed view exposes %', banned; END IF;
    END LOOP;
  END IF;

  RAISE NOTICE 'structural no-identity-leak OK';
END $$;
```

- [ ] **Step 2: Run it, expect PASS** (the RPC complies from Task 4; the view block is skipped until S12 lands). If the behavioral block fails, a prior task leaked identity — fix there.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/p4_feed_no_identity_leak.sql
git commit -m "P4: identity-leak test — feed view + RPC never return creator identity"
```

---

## Task 6: `record_swipe()` — idempotent swipe RPC

Swipe right/left, written once per `(swiper, instance)` (P0's unique index). Idempotent: re-calling with the same instance **updates the direction** (a user can change their mind right→left) and never errors or duplicates. The RPC also enforces that the instance is real and `seeking`, and that the swiper isn't the creator.

**Files:**
- Create: `supabase/migrations/20260525125300_p4_record_swipe_rpc.sql`
- Test: `supabase/tests/p4_record_swipe_idempotent.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p4_record_swipe_idempotent.sql
\i supabase/tests/_fixtures.sql   -- shared mk_user (Contract C8)
DO $$
DECLARE cre uuid; viewer uuid; cid uuid; inst uuid; n int; dir swipe_direction;
BEGIN
  insert into cities (slug,name,timezone,is_active) values ('sw','sw','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='sw';
  cre := mk_user('c'); viewer := mk_user('v');
  update profiles set dating_enabled=true where id in (cre, viewer);
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at,status)
    select i.id,cre,cid,now()+interval '2 days','seeking' from itineraries i where i.user_id=cre limit 1
    returning id into inst;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer::text)::text, true);

  PERFORM record_swipe(inst, 'right');
  PERFORM record_swipe(inst, 'right');   -- idempotent repeat
  select count(*) into n from swipes where swiper_id=viewer and date_instance_id=inst;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 swipe row, got %', n; END IF;

  PERFORM record_swipe(inst, 'left');    -- change of mind updates in place
  select direction into dir from swipes where swiper_id=viewer and date_instance_id=inst;
  IF dir <> 'left' THEN RAISE EXCEPTION 'expected updated direction left, got %', dir; END IF;
  select count(*) into n from swipes where swiper_id=viewer and date_instance_id=inst;
  IF n <> 1 THEN RAISE EXCEPTION 'change-of-mind created a duplicate row (%)', n; END IF;

  -- swiping your own night is rejected
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cre::text)::text, true);
  BEGIN
    PERFORM record_swipe(inst, 'right');
    RAISE EXCEPTION 'creator was allowed to swipe own night';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'creator was allowed to swipe own night' THEN RAISE; END IF;  -- re-raise our own
  END;

  RAISE NOTICE 'record_swipe idempotent OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `function record_swipe(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525125300_p4_record_swipe_rpc.sql
create or replace function record_swipe(p_instance uuid, p_direction swipe_direction)
returns void
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid := auth.uid(); v_creator uuid; v_status date_match_status; v_starts timestamptz;
begin
  if v_id is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  select creator_id, status, starts_at into v_creator, v_status, v_starts
    from date_instances where id = p_instance;
  if v_creator is null then raise exception 'instance_not_found' using errcode='P0002'; end if;
  if v_creator = v_id then raise exception 'cannot_swipe_own_night' using errcode='42501'; end if;
  if v_status <> 'seeking' then raise exception 'instance_not_open' using errcode='22023'; end if;
  -- Cannot swipe a past-dated night (mirrors the feed's starts_at>now() filter; audit lifecycle gap).
  if v_starts <= now() then raise exception 'instance_in_past' using errcode='22023'; end if;

  insert into swipes (swiper_id, date_instance_id, creator_id, direction)
  values (v_id, p_instance, v_creator, p_direction)
  on conflict (swiper_id, date_instance_id)
  do update set direction = excluded.direction;  -- idempotent: change-of-mind updates
end $fn$;

revoke all on function record_swipe(uuid, swipe_direction) from public;
grant execute on function record_swipe(uuid, swipe_direction) to authenticated;
```

> **Seam P4→P5 (MD9):** a right-swipe on a **seed** (`is_seed=true`) night is recorded by this same RPC (no special path) and P5's match-ingest consumes it. The "you're in line" confirmation UX is client-side (Task 9). The actual concierge resolution — turning that seeded interest into a real match — is the C2 match loop owned by **P5/S6**. **Depends on P5/MD9.** P4 must not invent a concierge actor or resolution flow here.

> P0's `swipes` insert policy is `swiper_id = auth.uid()`; SECURITY DEFINER bypasses RLS but the RPC sets `swiper_id := auth.uid()` itself, so it cannot forge a swipe for another user. The `on conflict … do update` makes this the single idempotent write path (the audit's "idempotency" concern for interest).

- [ ] **Step 4: Apply + run test, expect PASS** — prints `record_swipe idempotent OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525125300_p4_record_swipe_rpc.sql supabase/tests/p4_record_swipe_idempotent.sql
git commit -m "P4: record_swipe() idempotent RPC (one row per swiper/instance, future-only, change-of-mind updates)"
```

---

## Task 7: Cold-start / empty-feed strategy (seed content + fallback)

A thin market means a logged-in compatible user can legitimately exhaust the real feed. Concrete strategy, ordered:

1. **Real compatible nights first** (Task 4 already orders `is_seed asc`).
2. **Curated seed nights** — a small set of `is_seed=true` `date_instances` owned by a system "concierge" profile, representing high-quality example nights for the active city. They are real `seeking` instances so the *exact same* swipe/feed code path works. A right-swipe on a seed night (a) records the swipe via `record_swipe` (no special path) and (b) shows the real **"you're in line" `SeedConfirm` UI** (Task 9, no dead-end). The concierge **match resolution** — turning the seeded interest into a real match — is the C2 match loop owned by **P5/S6 (MD9)**: **Depends on P5/MD9.** P4 must not build a concierge resolution path or invent a concierge actor flow.
3. **Explicit empty state** when even seed content is exhausted: a designed `EmptyFeedState` that (a) explains the market is young, (b) routes the user to *create* a night (supply begets demand — symmetric marketplace, spec §2). (Notify-on-new-night is a P2/S2 notification surface, deferred.)

This task delivers the **seed data + the `is_seed` semantics**; the empty-state + seed-confirm UI lands in Task 9 and the ambient player in Task 8b.

**Files:**
- Create: `supabase/migrations/20260525125400_p4_feed_seed.sql`
- Test: `supabase/tests/p4_cold_start.sql`
- Create pure helper: `packages/business/src/compat.ts` (cold-start tier function) + `packages/business/src/compat.test.ts`

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/p4_cold_start.sql
\i supabase/tests/_fixtures.sql   -- shared mk_user (Contract C8)
DO $$
DECLARE viewer uuid; cid uuid; n_real int; n_seed int;
BEGIN
  select id into cid from cities where slug='kelowna';
  IF cid IS NULL THEN RAISE EXCEPTION 'kelowna seed missing (P0)'; END IF;

  viewer := mk_user('cs');
  update profiles set gender='man', gender_preferences='{woman,man,nonbinary}', age=30,
    age_pref='[18,99]', distance_pref_km=500, primary_city_id=cid, dating_enabled=true,
    verification='verified', account_state='active', standing='good' where id=viewer;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer::text)::text, true);
  select count(*) filter (where not is_seed), count(*) filter (where is_seed)
    into n_real, n_seed from browse_feed_for_viewer(50, null, null);

  -- With no real compatible nights, seed nights must carry the feed.
  IF n_seed < 1 THEN RAISE EXCEPTION 'cold-start: no seed nights surfaced (got % seed)', n_seed; END IF;
  RAISE NOTICE 'cold-start OK (real=%, seed=%)', n_real, n_seed;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `cold-start: no seed nights surfaced`.

- [ ] **Step 3: Write the migration (concierge profile + ≥3 seed nights for Kelowna)**

```sql
-- supabase/migrations/20260525125400_p4_feed_seed.sql
-- Deterministic system "concierge" profile that owns curated cold-start nights.
-- FIXED, VALID all-hex UUID so re-running is idempotent (audit B1: the original
-- '...0000000c0nc' contained 'n' and was 11 chars → not a valid uuid; it aborted
-- `db reset` and broke EVERY downstream phase's migration timeline. Replaced with a
-- valid all-hex constant). account_state='active' + standing='good' so the concierge
-- passes the Contract C11.3 surfacing filter; permissive prefs so it matches any viewer.
--
-- NOTE: profiles.id FKs auth.users (P0 schema). This migration must first ensure the
-- concierge auth.users row exists (system account, no login) before inserting the profile.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000c0ffe'::uuid,
        '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'concierge@system.after5.local', now(), now())
on conflict (id) do nothing;

insert into profiles (id, first_name, gender, gender_preferences, age, age_pref,
                      distance_pref_km, primary_city_id, dating_enabled, verification,
                      account_state, standing)
select '00000000-0000-0000-0000-0000000c0ffe'::uuid, 'After5', null, '{woman,man,nonbinary}',
       30, '[18,99]', 1000, c.id, true, 'verified', 'active', 'good'
from cities c where c.slug='kelowna'
on conflict (id) do update set dating_enabled = true, account_state = 'active', standing = 'good';

-- Three curated seed nights (evergreen itineraries + seeking instances), Kelowna.
-- starts_at = now()+7 days so they pass the feed's starts_at>now() filter at apply time.
do $$
declare cid uuid; conc uuid := '00000000-0000-0000-0000-0000000c0ffe'::uuid;
        it uuid; specs jsonb := '[
          {"vibe":["romantic","cozy"],"why":"Sunset wine flight on a lakeside patio.","amb":"https://cdn.tryafter5.app/ambient/lake-evening.mp3","st":"Lakeside evening","sl":"CC-BY-4.0","nb":"Downtown"},
          {"vibe":["adventurous","fun"],"why":"Golden-hour hike then tacos in the orchard.","amb":"https://cdn.tryafter5.app/ambient/orchard-birds.mp3","st":"Orchard birds","sl":"CC-BY-4.0","nb":"Mission"},
          {"vibe":["chill","intimate"],"why":"Vinyl bar, low light, two cocktails, no rush.","amb":"https://cdn.tryafter5.app/ambient/vinyl-bar.mp3","st":"Vinyl bar hum","sl":"CC-BY-4.0","nb":"Pandosy"}
        ]'::jsonb;
        s jsonb;
begin
  select id into cid from cities where slug='kelowna';
  for s in select * from jsonb_array_elements(specs) loop
    insert into itineraries (id,user_id,pay_setting,vibe_tags,why_note,ambient_sound_url,sound_title,sound_license)
      values (gen_random_uuid(), conc, 'split',
              array(select jsonb_array_elements_text(s->'vibe')),
              s->>'why', s->>'amb', s->>'st', s->>'sl')
      returning id into it;
    insert into date_instances (itinerary_id,creator_id,city_id,starts_at,status,is_seed)
      values (it, conc, cid, now()+interval '7 days', 'seeking', true);  -- moderation_status defaults 'approved'
  end loop;
end $$;
```

> **Decision — seed as real rows, not a separate path:** seed nights are ordinary `seeking` instances flagged `is_seed`, so the feed, swipe, and leak tests all exercise the identical code. The only difference is ordering (real first) and the client badge/empty-state copy. Concierge identity is still blind in the feed (same RPC).
> **Decision — seed-night swipe routing (MD9, seam P4→P5):** a right-swipe on a seed night records normally (`record_swipe`) AND the client shows the real "you're in line" confirmation (Task 9 `SeedConfirm`). **The concierge match resolution is owned by P5/S6 — Depends on P5/MD9.** P4 does not build a concierge resolution path; it must not dead-end (audit C1) — the confirmation UX is real and P5's match-ingest accepts the seeded interest.
> **Lifecycle note (audit §4):** seed nights are dated `now()+7 days`; after 7 days `starts_at <= now()` so the feed's `starts_at > now()` filter (Task 4) stops surfacing them — no stale seed nights leak. **Re-rolling/refreshing expired seed nights is a scheduled job owned by P2/P5 (jobs spine), not P4.** P4 only guarantees the filter never shows past-dated seeds.

- [ ] **Step 4: Apply + run SQL test, expect PASS** — prints `cold-start OK`.

- [ ] **Step 5: Pure cold-start tier helper + vitest**

```ts
// packages/business/src/compat.ts
import type { FeedCard } from '@after5/validators';

// Pure decision: what should the client render given a fetched page?
export type FeedTier = 'real' | 'seed_only' | 'empty';

export function feedTier(cards: FeedCard[]): FeedTier {
  if (cards.some((c) => !c.is_seed)) return 'real';
  if (cards.length > 0) return 'seed_only';   // only curated/concierge nights left
  return 'empty';                              // exhausted — show create-a-night CTA
}

// Pure mirror of the SQL mutual-compatibility predicate, for client-side
// preview/explanation and unit-testing the rules independent of the DB.
export interface MiniProfile {
  gender: string | null;
  genderPreferences: string[];
  age: number | null;
  agePrefMin: number | null;
  agePrefMax: number | null;
}
export function isHardCompatible(viewer: MiniProfile, creator: MiniProfile): boolean {
  const genderOk =
    (viewer.genderPreferences.length === 0 || (creator.gender != null && viewer.genderPreferences.includes(creator.gender))) &&
    (creator.genderPreferences.length === 0 || (viewer.gender != null && creator.genderPreferences.includes(viewer.gender)));
  const inRange = (age: number | null, lo: number | null, hi: number | null) =>
    age == null || lo == null || hi == null || (age >= lo && age <= hi);
  const ageOk =
    inRange(creator.age, viewer.agePrefMin, viewer.agePrefMax) &&
    inRange(viewer.age, creator.agePrefMin, creator.agePrefMax);
  return genderOk && ageOk;
}
```

```ts
// packages/business/src/compat.test.ts
import { describe, it, expect } from 'vitest';
import { feedTier, isHardCompatible } from './compat';

const card = (is_seed: boolean) => ({ is_seed } as any);

describe('feedTier', () => {
  it('real when any non-seed', () => expect(feedTier([card(false), card(true)])).toBe('real'));
  it('seed_only when all seed', () => expect(feedTier([card(true)])).toBe('seed_only'));
  it('empty when none', () => expect(feedTier([])).toBe('empty'));
});

describe('isHardCompatible (mutual)', () => {
  const man = { gender: 'man', genderPreferences: ['woman'], age: 28, agePrefMin: 25, agePrefMax: 35 };
  const woman = { gender: 'woman', genderPreferences: ['man'], age: 30, agePrefMin: 26, agePrefMax: 32 };
  it('compatible both ways', () => expect(isHardCompatible(man, woman)).toBe(true));
  it('fails when creator gender not wanted', () =>
    expect(isHardCompatible(man, { ...woman, gender: 'man' })).toBe(false));
  it('fails when creator out of viewer age range', () =>
    expect(isHardCompatible(man, { ...woman, age: 50 })).toBe(false));
  it('fails when viewer out of creator age range', () =>
    expect(isHardCompatible(man, { ...woman, agePrefMin: 31, agePrefMax: 40 })).toBe(false));
});
```

Export from `packages/business/src/index.ts`: `export * from './compat';`

- [ ] **Step 6: Run vitest, expect PASS** — `pnpm --filter @after5/business test`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260525125400_p4_feed_seed.sql supabase/tests/p4_cold_start.sql
git add packages/business/src/compat.ts packages/business/src/compat.test.ts packages/business/src/index.ts
git commit -m "P4: cold-start strategy — concierge seed nights (valid UUID) + feedTier/isHardCompatible helpers"
```

---

## Task 8: API-client feed helpers (the shared, native-reusable surface)

The typed entry points web + native both call. `browseFeed()` invokes the RPC and parses each row through `FeedCardSchema` (so a leaked identity field would be **stripped** at the boundary — defense in depth). `recordSwipe()` invokes `record_swipe`.

**Files:**
- Create: `packages/api-client/src/feed.ts`, `packages/api-client/src/feed.test.ts`
- Modify: `packages/api-client/src/index.ts`, `packages/api-client/package.json` (add `"test": "vitest run"`)

- [ ] **Step 1: Write the failing test (mocked client)**

```ts
// packages/api-client/src/feed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { browseFeed, recordSwipe } from './feed';

function mockClient(rpcImpl: (name: string, args: any) => any) {
  return { rpc: vi.fn(rpcImpl) } as any;
}

describe('browseFeed', () => {
  it('parses rows to blind FeedCard, dropping any leaked identity field', async () => {
    const client = mockClient(() => ({
      data: [{
        date_instance_id: '00000000-0000-0000-0000-000000000001',
        city_id: '00000000-0000-0000-0000-000000000002',
        itinerary_id: '00000000-0000-0000-0000-000000000003',
        time_window_start: '2026-06-01T19:00:00+00:00',
        venue_neighborhood: 'Downtown', vibe_tags: ['romantic'],
        why_note: 'x', sound_title: 'amb', sound_license: 'CC-BY-4.0',
        ambient_sound_url: null, pay_setting: 'split',
        distance_m: 1000, is_seed: false,
        creator_id: 'LEAKED-SHOULD-BE-STRIPPED',   // hostile row
      }],
      error: null,
    }));
    const cards = await browseFeed(client, { limit: 20, cursor: null });
    expect(cards).toHaveLength(1);
    expect((cards[0] as any).creator_id).toBeUndefined();   // stripped at boundary
    expect(client.rpc).toHaveBeenCalledWith('browse_feed_for_viewer', {
      p_limit: 20, p_cursor_is_seed: null, p_cursor_id: null,
    });
  });
  it('passes a composite keyset cursor for loadMore (page 2)', async () => {
    const client = mockClient(() => ({ data: [], error: null }));
    await browseFeed(client, {
      limit: 20,
      cursor: { is_seed: false, date_instance_id: '00000000-0000-0000-0000-000000000009' },
    });
    expect(client.rpc).toHaveBeenCalledWith('browse_feed_for_viewer', {
      p_limit: 20, p_cursor_is_seed: false, p_cursor_id: '00000000-0000-0000-0000-000000000009',
    });
  });
});

describe('recordSwipe', () => {
  it('invokes record_swipe with instance + direction', async () => {
    const client = mockClient(() => ({ data: null, error: null }));
    await recordSwipe(client, { date_instance_id: '00000000-0000-0000-0000-000000000001', direction: 'right' });
    expect(client.rpc).toHaveBeenCalledWith('record_swipe', {
      p_instance: '00000000-0000-0000-0000-000000000001', p_direction: 'right',
    });
  });
  it('throws on RPC error', async () => {
    const client = mockClient(() => ({ data: null, error: { message: 'boom' } }));
    await expect(recordSwipe(client, { date_instance_id: 'x', direction: 'left' } as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — cannot find `./feed`.

- [ ] **Step 3: Write the real code**

```ts
// packages/api-client/src/feed.ts
import type { After5Client } from './index';
import {
  FeedCardSchema, FeedQuerySchema, SwipeInputSchema,
  type FeedCard, type FeedQuery, type SwipeInput,
} from '@after5/validators';

// Blind, pre-filtered feed. Parsing through FeedCardSchema is the client-side
// half of the blind contract: even if the DB regressed and returned identity,
// it is stripped here. (DB is the primary guard — see browse_feed_for_viewer.)
// Keyset cursor is the composite (is_seed, date_instance_id) of the last row on the
// previous page (audit B4) — matches the RPC's ORDER BY is_seed asc, id asc.
export async function browseFeed(client: After5Client, query: FeedQuery): Promise<FeedCard[]> {
  const q = FeedQuerySchema.parse(query);
  const { data, error } = await (client as any).rpc('browse_feed_for_viewer', {
    p_limit: q.limit,
    p_cursor_is_seed: q.cursor?.is_seed ?? null,
    p_cursor_id: q.cursor?.date_instance_id ?? null,
  });
  if (error) throw error;
  return (data ?? []).map((row: unknown) => FeedCardSchema.parse(row));
}

// Helper: derive the next-page cursor from a page of cards (null when no more).
export function nextCursor(cards: FeedCard[], pageLimit: number): FeedQuery['cursor'] {
  if (cards.length < pageLimit || cards.length === 0) return null; // last page
  const last = cards[cards.length - 1];
  return { is_seed: last.is_seed, date_instance_id: last.date_instance_id };
}

export async function recordSwipe(client: After5Client, input: SwipeInput): Promise<void> {
  const v = SwipeInputSchema.parse(input);
  const { error } = await (client as any).rpc('record_swipe', {
    p_instance: v.date_instance_id, p_direction: v.direction,
  });
  if (error) throw error;
}
```

Append to `packages/api-client/src/index.ts`: `export * from './feed';`

- [ ] **Step 4: Run it, expect PASS** — `pnpm --filter @after5/api-client test`.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/feed.ts packages/api-client/src/feed.test.ts packages/api-client/src/index.ts packages/api-client/package.json
git commit -m "P4: api-client browseFeed()/recordSwipe() — shared native-reusable feed surface w/ boundary parsing"
```

---

## Task 8b: Ambient player — native-first with explicit web fallback

Encapsulate the spec §10 reality: iOS Safari blocks autoplay-with-sound, so web cannot "feel the night while scrolling" automatically. Ship an **explicit, graceful fallback**, never a dead control. Decision: on web the audio is **gesture-gated** — the card shows a clearly-labeled play/mute control (visible, never auto-playing), and a non-audio equivalent (a "🔊 ambient: lakeside evening" caption) so the experience degrades to text, not silence-with-broken-button. Native (later) sets `autoPlay` via the platform flag.

**Files:**
- Create: `apps/web/components/feed/AmbientPlayer.tsx`

- [ ] **Step 1: Write the component** (client component)

```tsx
'use client';
// AmbientPlayer — native-first ambient sound with an explicit web fallback.
// Web: NEVER autoplays (iOS Safari blocks it → would render a dead control).
// Instead: a labeled tap-to-play toggle + a text caption (a11y + honest fallback).
import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

export function AmbientPlayer({
  src, label, autoPlay = false,   // autoPlay only true on native via the platform wrapper
}: { src: string | null; label?: string; autoPlay?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!autoPlay || !ref.current) return;
    ref.current.play().then(() => setPlaying(true)).catch(() => setBlocked(true)); // graceful: no throw
  }, [autoPlay, src]);

  if (!src) {
    return <p className="text-xs text-muted">No ambient sound for this night.</p>;
  }
  const toggle = async () => {
    const el = ref.current; if (!el) return;
    try {
      if (el.paused) { await el.play(); setPlaying(true); setBlocked(false); }
      else { el.pause(); setPlaying(false); }
    } catch { setBlocked(true); }
  };
  return (
    <div className="flex items-center gap-2">
      <audio ref={ref} src={src} loop preload="none" />
      <button
        type="button" onClick={toggle}
        aria-label={playing ? 'Mute ambient sound' : 'Play ambient sound'}
        className="inline-flex items-center gap-1.5 rounded-pill border border-border px-3 py-1.5 text-xs text-secondary hover:text-text"
      >
        {playing ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        <span>Ambient: {label ?? 'tap to play'}</span>
      </button>
      {blocked && <span className="text-[11px] text-muted">Tap to hear it — autoplay is off on web.</span>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @after5/web typecheck` (or root `pnpm typecheck`). Expect clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/feed/AmbientPlayer.tsx
git commit -m "P4: AmbientPlayer — native-first, web gesture-gated w/ text fallback (no dead control)"
```

---

## Task 9: Regenerate types + web feed page, card, swipe deck, empty state, swipe route, pagination route, seed confirm

Wire the web surface as a thin RSC over `api-client`. The page fetches the first page server-side, renders the deck client component which (a) posts swipes to a thin route that calls the RPC, (b) **loads more pages** via a thin GET route when the buffer runs low (real keyset pagination — audit B4), and (c) shows a real **"you're in line"** confirmation when the user right-swipes a **seed** night (MD9 — no dead-end, audit C1). Empty/seed states come from `feedTier`; the in-deck exhausted state shows the **same create-a-night CTA** as the initial empty state (audit fix — no dead "No more nights" string).

> **Pay labels (CC5):** the canonical pay-setting labels + the "who pays" disclaimer are owned by **P10/S11** and applied on every pay surface. P4 must render the **P10 canonical labels**, not its own ad-hoc strings. Until S11 lands, P4 references the P10 label/disclaimer helper (e.g. `payLabel(pay_setting)` from the shared package) rather than hardcoding "They treat"/"Your treat" (which the audit flagged as contradictory with P10). **Do not hardcode divergent pay copy.**
> **Distance (B5):** render distance as a **coarse label** ("~5 km", "in your area"), never a false personal "4.2 km away" — distance is venue→viewer-city-centroid, not the viewer's precise point.

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)
- Create: `apps/web/app/feed/page.tsx`, `apps/web/app/feed/EmptyFeedState.tsx`,
  `apps/web/app/feed/SeedConfirm.tsx`,
  `apps/web/components/feed/FeedCard.tsx`, `apps/web/components/feed/SwipeDeck.tsx`,
  `apps/web/app/api/feed/swipe/route.ts`, `apps/web/app/api/feed/route.ts`

- [ ] **Step 1: Regenerate types** — `supabase db reset && pnpm db:types`. Expect `browse_feed_for_viewer`, `record_swipe`, `date_instances.geo`, `date_instances.is_seed` to appear.

- [ ] **Step 2a: Swipe route (thin POST → RPC)**

```ts
// apps/web/app/api/feed/swipe/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recordSwipe } from '@after5/api-client';
import { SwipeInputSchema } from '@after5/validators';

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = SwipeInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_input' }, { status: 400 });
  const supabase = await createClient();
  try {
    await recordSwipe(supabase as any, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'swipe_failed' }, { status: 400 });
  }
}
```

- [ ] **Step 2b: Pagination route (thin POST → browse_feed_for_viewer; the loadMore endpoint, audit B4)**

```ts
// apps/web/app/api/feed/route.ts
// The "next page" endpoint the deck calls when its buffer runs low. Without this
// route the feed was capped at the initial 20 cards (audit B4). Keyset cursor is the
// composite (is_seed, date_instance_id) of the last card from the previous page.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { browseFeed } from '@after5/api-client';
import { FeedQuerySchema } from '@after5/validators';

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = FeedQuerySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_input' }, { status: 400 });
  const supabase = await createClient();
  try {
    const cards = await browseFeed(supabase as any, parsed.data);
    return NextResponse.json({ cards });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'feed_failed' }, { status: 400 });
  }
}
```

- [ ] **Step 3: Feed page (RSC) + empty state + deck + card**

```tsx
// apps/web/app/feed/page.tsx
import { createClient } from '@/lib/supabase/server';
import { browseFeed } from '@after5/api-client';
import { feedTier } from '@after5/business';
import { SwipeDeck } from '@/components/feed/SwipeDeck';
import { EmptyFeedState } from './EmptyFeedState';

export const dynamic = 'force-dynamic';   // personalized, per-viewer; never cached

export default async function FeedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return <main className="p-8"><p>Sign in to browse nights.</p></main>;
  }
  // ERROR state: the RPC can throw (e.g. viewer has no profile row). Catch it and
  // render a real retry surface instead of bubbling to Next's generic error boundary.
  let cards;
  try {
    cards = await browseFeed(supabase as any, { limit: 20, cursor: null });
  } catch {
    return (
      <main className="mx-auto max-w-content px-6 py-10">
        <EmptyFeedState variant="error" />
      </main>
    );
  }
  const tier = feedTier(cards);
  return (
    <main className="mx-auto max-w-content px-6 py-10">
      {tier === 'empty'
        ? <EmptyFeedState variant="exhausted" />
        : <>
            {tier === 'seed_only' && <EmptyFeedState variant="seed_only" />}
            <SwipeDeck initialCards={cards} pageLimit={20} />
          </>}
    </main>
  );
}
```

```tsx
// apps/web/app/feed/EmptyFeedState.tsx
import Link from 'next/link';
export function EmptyFeedState({ variant }: { variant: 'exhausted' | 'seed_only' | 'error' }) {
  const copy = {
    exhausted: { h: "You're all caught up.", p: "The Kelowna scene is young — the fastest way to get a match is to post a night of your own. People swipe on the night, not the face." },
    seed_only: { h: "A few curated nights to start.", p: "More real nights are posting every week. Want to seed the scene? Create your own night." },
    error:     { h: "We couldn't load your feed.", p: "Something went wrong fetching nights. Try again, or post a night while we sort it out." },
  }[variant];
  return (
    <section className="rounded-2xl border border-border p-8 text-center">
      <h2 className="font-display text-2xl text-text">{copy.h}</h2>
      <p className="mx-auto mt-3 max-w-prose text-secondary">{copy.p}</p>
      <Link href="/plan" className="mt-6 inline-flex rounded-pill bg-primary px-6 py-3 text-sm text-background">
        Create a night
      </Link>
    </section>
  );
}
```

```tsx
// apps/web/app/feed/SeedConfirm.tsx
'use client';
// "You're in line" — the real cold-start payoff (MD9 / audit C1). Shown after a
// right-swipe on a SEED (concierge) night. The seed swipe is recorded normally; the
// concierge match resolution is owned by P5/S6 (Depends on P5/MD9). This UI must NOT
// dead-end: it confirms the interest landed and that a real match will be lined up.
export function SeedConfirm({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="seed-confirm-h"
         className="rounded-2xl border border-border bg-surface p-8 text-center">
      <h2 id="seed-confirm-h" className="font-display text-2xl text-text">You're in line.</h2>
      <p className="mx-auto mt-3 max-w-prose text-secondary">
        This is a curated night while the Kelowna scene fills in. We've noted your interest —
        we'll line you up with a real match as soon as one fits. You'll be notified.
      </p>
      <button type="button" onClick={onClose}
        className="mt-6 inline-flex rounded-pill bg-primary px-6 py-3 text-sm text-background">
        Keep browsing
      </button>
    </div>
  );
}
```

```tsx
// apps/web/components/feed/SwipeDeck.tsx
'use client';
import { useState } from 'react';
import type { FeedCard } from '@after5/validators';
import { nextCursor } from '@after5/api-client';
import { FeedCard as Card } from './FeedCard';
import { EmptyFeedState } from '@/app/feed/EmptyFeedState';
import { SeedConfirm } from '@/app/feed/SeedConfirm';

const LOAD_MORE_THRESHOLD = 5;   // refetch when buffer runs low (keyset pagination, B4)

export function SwipeDeck({ initialCards, pageLimit }: { initialCards: FeedCard[]; pageLimit: number }) {
  const [cards, setCards] = useState(initialCards);
  const [cursor, setCursor] = useState(() => nextCursor(initialCards, pageLimit));
  const [busy, setBusy] = useState(false);
  const [exhausted, setExhausted] = useState(false);   // server confirmed no more pages
  const [error, setError] = useState<string | null>(null);
  const [seedConfirm, setSeedConfirm] = useState(false);

  // EXHAUSTED state: same create-a-night CTA as initial empty (audit fix — no dead string).
  if (cards.length === 0) return <EmptyFeedState variant="exhausted" />;
  if (seedConfirm) return <SeedConfirm onClose={() => setSeedConfirm(false)} />;

  const top = cards[0];

  const loadMore = async () => {
    if (cursor === null || exhausted) return;
    const res = await fetch('/api/feed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: pageLimit, cursor }),
    });
    if (!res.ok) return;                       // keep current buffer; surfaced on next swipe error
    const { cards: more } = (await res.json()) as { cards: FeedCard[] };
    if (more.length === 0) { setExhausted(true); setCursor(null); return; }
    setCards((c) => [...c, ...more]);
    setCursor(nextCursor(more, pageLimit));
  };

  const swipe = async (direction: 'right' | 'left') => {
    if (busy) return; setBusy(true); setError(null);
    const swiped = top;
    try {
      const res = await fetch('/api/feed/swipe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date_instance_id: swiped.date_instance_id, direction }),
      });
      if (!res.ok) { setError('That swipe did not go through. Try again.'); return; }  // do NOT drop the card on failure
      setCards((c) => c.slice(1));
      // Real "you're in line" payoff for a right-swipe on a seed night (MD9).
      if (direction === 'right' && swiped.is_seed) setSeedConfirm(true);
      // Keyset loadMore when the buffer runs low.
      if (cards.length - 1 <= LOAD_MORE_THRESHOLD) void loadMore();
    } catch {
      setError('Network error — your swipe was not saved. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <Card card={top} />
      {error && <p role="alert" className="mt-3 text-center text-xs text-danger">{error}</p>}
      <div className="mt-6 flex justify-center gap-4">
        <button disabled={busy} onClick={() => swipe('left')}
          className="rounded-pill border border-border px-8 py-3 text-secondary">Pass</button>
        <button disabled={busy} onClick={() => swipe('right')}
          className="rounded-pill bg-primary px-8 py-3 text-background">I want this night</button>
      </div>
    </div>
  );
}
```

> **Note on the error path (audit):** a failed swipe **no longer drops the card** — the interest is preserved and the user sees a retry message (`role="alert"`). The original `finally { slice(1) }` silently lost the swipe.

```tsx
// apps/web/components/feed/FeedCard.tsx
import type { FeedCard as FeedCardT } from '@after5/validators';
import { payLabel } from '@after5/business';   // CANONICAL pay label (owner P10/S11, CC5) — do NOT hardcode
import { AmbientPlayer } from './AmbientPlayer';

// Coarse distance bucket (audit B5): distance is venue→viewer-city-centroid, not the
// viewer's precise point, so never claim a false "4.2 km away".
function distanceLabel(m: number | null): string | null {
  if (m == null) return null;
  const km = m / 1000;
  if (km < 3) return 'in your area';
  if (km < 10) return '~5 km away';
  if (km < 25) return '~15 km away';
  return 'across town';
}

export function FeedCard({ card }: { card: FeedCardT }) {
  const when = new Date(card.time_window_start);
  const dist = distanceLabel(card.distance_m);
  return (
    <article className="rounded-2xl border border-border p-6">
      {card.is_seed && <span className="text-[11px] uppercase tracking-wide text-muted">Curated</span>}
      <p className="text-xs text-muted">{card.venue_neighborhood ?? 'Kelowna'} · {when.toLocaleDateString(undefined,{ weekday:'long' })} evening</p>
      <p className="mt-3 text-lg text-text">{card.why_note}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {card.vibe_tags.map((v) => <span key={v} className="rounded-pill bg-surface px-3 py-1 text-xs">{v}</span>)}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-secondary">
        <span>{payLabel(card.pay_setting)}</span>{/* canonical P10 label + disclaimer surface */}
        {dist && <span>{dist}</span>}
      </div>
      <div className="mt-4"><AmbientPlayer src={card.ambient_sound_url} label={card.sound_title ?? card.vibe_tags[0]} /></div>
    </article>
  );
}
```

> **`payLabel` dependency (CC5):** `payLabel(pay_setting)` is the canonical pay-setting label helper owned by **P10/S11** (one label set + disclaimer applied on every pay surface). If S11 has not landed when this slice runs, that is a P10 dependency — reference it, do not hardcode divergent copy (the original "They treat"/"Your treat" strings contradicted P10 and are removed). The "who pays" disclaimer wiring on this surface is completed by S11 (DU1).

- [ ] **Step 4: Typecheck the web app** — `pnpm typecheck`. Expect clean. (No headless browser test in P4; visual/a11y polish is P11/S12.)

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts apps/web/app/feed apps/web/components/feed/FeedCard.tsx apps/web/components/feed/SwipeDeck.tsx apps/web/app/api/feed/swipe/route.ts apps/web/app/api/feed/route.ts
git commit -m "P4: web feed page (RSC via api-client) + swipe/pagination routes + keyset loadMore + seed-confirm + error/empty states"
```

---

## Task 10: Full reset + run every P4 test (verification gate)

- [ ] **Step 1: Full reset** — `supabase db reset` (applies P0 + P4 migrations + seeds). Expect no error.

- [ ] **Step 2: Run all P4 SQL tests**

```bash
for f in supabase/tests/p4_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: each exits 0; notices print `… OK`. **`p4_feed_no_identity_leak.sql` passing is the launch-gate for the blind contract.**

- [ ] **Step 3: Run all P4 TS tests** — `pnpm --filter @after5/validators test && pnpm --filter @after5/business test && pnpm --filter @after5/api-client test`. Expect all PASS.

- [ ] **Step 4: Typecheck whole repo** — `pnpm typecheck`. Expect clean.

- [ ] **Step 5: Commit (if any test-fix churn)** — only if changes were needed; otherwise nothing to commit.

---

## Self-Review

**Contract conformance (this slice is subordinate to INTEGRATION-CONTRACT.md v2 / C11 + RECONCILED-MASTER-PLAN.md):**
- **`browse_feed` view NOT created in P4** (Contract C4/C11.3) → Task 3 reduced to a base-table `alter table date_instances add is_seed` only. The view is the **S12 finalization at band `133000`** (drop+create). P4 owns the feed SHAPE via the RPC, which projects the Contract C4 columns + `distance_m`. ✅
- **Migration band corrected to `125000–1259xx`** (Contract C6) — the old `1300xx` band collided with P9. ✅
- **Canonical surfacing filter (Contract C11.3)** applied in `browse_feed_for_viewer` (and to be matched by the S12 view): `status='seeking' AND starts_at>now() AND moderation_status='approved' AND creator account_state='active' AND creator standing NOT IN ('suspended','locked_ban')`. ✅
- **vitest:** P4 creates no vitest config; uses P1's root config (Contract C10). ✅
- **Fixtures:** all psql tests `\i _fixtures.sql` and create actors via `mk_user`; P4's geo helper is named `mk_geo_instance` (does not clobber the C8 `mk_instance`). ✅
- **Pay labels:** FeedCard uses the canonical `payLabel()` (owner P10/S11, CC5) — no divergent hardcoded copy. ✅
- **Seed-night routing (MD9):** right-swipe on a seed night shows a real "you're in line" `SeedConfirm`; concierge resolution is P5/S6 (Depends on P5/MD9). No dead-end. ✅

**Spec coverage (vs roadmap P4 'Closes' list):**
- **Blind feed (S12 view + P4 RPC)** → RPC returns only Contract C4 blind columns + distance; the view is owned by S12. ✅
- **Blind ≠ unfiltered / "filter quality = trust dependency"** → Task 4 mutual compatibility pre-filter (orientation via gender+gender_preferences, age range both ways, PostGIS distance) + future-only + moderation + account/standing, with a pure mirror `isHardCompatible` unit-tested in Task 7. ✅
- **PostGIS distance (cities.centroid + distance_pref_km)** → Task 2 adds real `date_instances.geo`; Task 4 uses `ST_DWithin(geo, viewer_city_centroid, radius_m)`; client renders coarse labels (B5). ✅
- **Swipe RIGHT/LEFT, idempotent, one per swiper/instance, future-only** → Task 6 `record_swipe()` with `on conflict do update` + `starts_at>now()` guard. ✅
- **Ambient playback native-first + explicit web fallback** → Task 8b `AmbientPlayer`. ✅
- **Cold-start / empty-feed strategy** → Task 7 concierge seed nights (valid UUID, `is_seed`, real `seeking` rows) ordered after real nights; Task 9 `feedTier` → `EmptyFeedState` (exhausted/seed_only/error) + in-deck exhausted CTA + `SeedConfirm`. ✅
- **Real keyset pagination (audit B4)** → composite `(is_seed, id)` cursor in RPC + `nextCursor` helper + `/api/feed` loadMore route + buffer-low refetch in `SwipeDeck`. No 20-night cap. ✅
- **Test that the feed never returns creator identity** → Task 5 `p4_feed_no_identity_leak.sql` (BEHAVIORAL PII assertion primary + structural guards) + Task 8 boundary parse. ✅
- **API-first (logic in shared so native reuses it)** → all query/swipe/tier logic in `api-client`/`business`/`validators`; web is a thin RSC + routes (spec §10). ✅

**Decisions / assumptions made explicit:**
1. **Orientation modeled as `gender` + `gender_preferences text[]`** (the P0/P1 columns), not a separate `orientation` enum. The mutual filter requires both directions to accept.
2. **Distance measured venue→viewer-city-centroid**, rendered as a coarse label (B5). Viewer's precise location is not stored server-side pre-native; the RPC can later take an optional viewer point additively.
3. **`date_instances.geo` added in P4** (base-table alter) — venue point with city-centroid fallback; explicit-geo-on-insert is respected. The `set_date_instance_geo` trigger's final behavior is documented as **P4-owned** (audit C3 — single owner; P3's convert RPC uses it).
4. **Empty/permissive prefs are permissive in the filter**; **P1 owns making orientation/age prefs required at onboarding** (cross-stage dependency — see Depends-on). Until P1 enforces this, a half-onboarded creator could over-surface; flagged, not silently dropped.
5. **Cold-start = real concierge seed rows**, not a separate code path. A right-swipe on a seed night records normally; the concierge-match resolution is **owned by P5/S6 (MD9)** and the "you're in line" confirmation is real.
6. **No new chat/notification/match surface** (P5/P6); right-swipe only writes a `swipe`. The match consequence is P5.
7. **Anti-triangulation:** raw `geo` is never exposed; only a coarse distance label + hour-truncated time + neighborhood (spec §4).

**Deferred to later phases (intentionally NOT in P4 — Depends on):** shortlist/rank/offer/lock + reciprocal-pair detection + **seed-night concierge resolution (MD9)** + demand hints (P5/S6); chat at offer (P6/S7); push notifications for new compatible nights + stale-seed re-roll job (P2/S2); the `browse_feed` view finalization (S12); canonical pay labels + disclaimer wiring (P10/S11, CC5); a11y audit + analytics events on swipe (P11/S12); precise native location capture (native build).

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. No dead UI: the in-deck exhausted state and seed-night swipe both resolve to real surfaces. Ambient CDN URLs in the seed are illustrative paths owned by P3's media pipeline; the playable URL is minted by P3 — if P3's library uses different paths/`sound_title`, the seed migration is the only thing to update.

**Type/name consistency:** `browse_feed_for_viewer(int,boolean,uuid)`, `record_swipe(uuid, swipe_direction)`, `date_instances.geo`/`.is_seed`, `FeedCardSchema`/`FeedQuerySchema` (composite cursor)/`SwipeInputSchema`, `browseFeed`/`recordSwipe`/`nextCursor`, `feedTier`/`isHardCompatible`, `payLabel` (from P10/S11) are referenced consistently across SQL, validators, business, api-client, and web.

**Risk note:** the SQL behavioral tests set `request.jwt.claims.sub` via `set_config` to simulate `auth.uid()` inside SECURITY DEFINER RPCs; this is the standard local-psql technique. The leak test's **primary** guard is now behavioral (real PII never appears in returned text fields); `pg_proc` structural checks are belt-and-suspenders only (audit B3).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p4-browse-feed.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session using executing-plans, with checkpoints at Task 5 (leak gate) and Task 10 (verification gate).
