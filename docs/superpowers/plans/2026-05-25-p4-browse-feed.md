# P4 — Browse & Interest (Experience-First Feed) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **blind, compatibility-pre-filtered** feed of open dates and the swipe-interest mechanic — the discovery surface of the experience-first loop. A browser sees the *night* (vibe, the "why", place photo, ambient sound, pay setting, neighborhood + coarse time window) and **never** the creator's identity, yet only sees nights from people who *could* be a mutual match (orientation, gender prefs, age range, distance). Swiping right/left writes idempotently to `swipes`. Ambient sound plays native-first with an explicit, graceful no-audio fallback on web. A concrete cold-start / empty-feed strategy carries a thin market.

**Architecture:** API-first. The feed query, the server-side compatibility pre-filter, and the swipe writes all live as a **SECURITY DEFINER RPC** (`browse_feed_for_viewer`) + a **swipe RPC** (`record_swipe`) in the database, fronted by typed helpers in `packages/api-client` so web today and native later call identical code (spec §10). The blind contract is enforced **in the database** (P0's `browse_feed` view has no `creator_id`; the RPC selects only feed columns and applies the filter server-side, so a compatible-but-anonymous result set is all the client ever receives). The cold-start tiering and the "is this a hard match" predicate are pure functions in `packages/business`. Web renders a React Server Component feed page that fetches through `api-client`; the swipe action and ambient player are thin client components.

**Tech Stack:** Supabase Postgres + PostGIS (distance via `ST_DWithin` on `geography`), SQL migrations (`supabase/migrations/`), RLS + SECURITY DEFINER RPCs, psql invariant/leak tests (`supabase/tests/`), `packages/api-client` + `packages/business` + `packages/validators` (TS), vitest for TS unit tests, Next.js App Router (`apps/web/app/feed`) + the existing `createClient()` server helper. No new notification or chat surface (P2/P6).

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§5 browsing, §4 pre-lock privacy, §10 native-first); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (Phase 4); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (`browse_feed`, `swipes`, `date_instances`, `cities`, `profiles` dating columns).

**Depends on (must land first):**
- **P0** — `cities` (with `centroid geography(Point,4326)`), `date_instances` (`creator_id`, `city_id`, `venue_id`, `status='seeking'`, `time_range`), `swipes` (unique `(swiper_id, date_instance_id)` + blind RLS), `browse_feed` view (security_invoker, **no `creator_id`**), `profiles` dating columns. PostGIS + `btree_gist` enabled.
- **P1** — preference fields populated on `profiles`: `gender`, `gender_preferences text[]`, `age` / `age_pref int4range`, `distance_pref_km`, `primary_city_id`, `dating_enabled`, `verification`. (P0 created the columns; P1 owns onboarding that fills them.) The pre-filter reads these.
- **P3** — *some* content exists (`date_instances` with `status='seeking'` and `itineraries.ambient_sound_url` from the curated library). P4 can ship with library-only audio.

**Closes (audit):** "blind but pre-filtered" (filter quality = trust dependency); "empty feed at launch / cold-start"; RLS identity-leak risk (test that the feed never returns creator identity); dead ambient-on-web (explicit fallback).

**Conventions (follow exactly — mirrors P0):**
- Migration filenames `YYYYMMDDHHMMSS_snake_description.sql`; this phase uses the `20260525130000`–`20260525139999` band (after P0's `1211…`).
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
    20260525130000_p4_date_instance_geo.sql        # geo point on date_instances + backfill + feed-distance index
    20260525130100_p4_browse_feed_geo.sql           # extend browse_feed view with distance_m (no identity)
    20260525130200_p4_browse_feed_rpc.sql           # browse_feed_for_viewer() SECURITY DEFINER pre-filter RPC
    20260525130300_p4_record_swipe_rpc.sql          # record_swipe() idempotent swipe RPC
    20260525130400_p4_feed_seed.sql                 # cold-start seed flag + curated fallback content seed (Kelowna)
  tests/
    p4_feed_no_identity_leak.sql                    # THE leak test: RPC + view never return creator identity
    p4_compat_prefilter.sql                         # orientation/gender/age/distance filtering correctness
    p4_record_swipe_idempotent.sql                  # one swipe per swiper/instance; re-swipe updates, never duplicates
    p4_cold_start.sql                               # empty real feed → curated fallback rows surface
packages/
  validators/src/feed.ts                            # FeedCard, FeedQuery, SwipeInput zod schemas + exports in index.ts
  business/src/compat.ts                             # pure isHardCompatible() + cold-start tier selection
  business/src/compat.test.ts                        # vitest
  api-client/src/feed.ts                              # browseFeed(), recordSwipe() typed helpers
  api-client/src/feed.test.ts                         # vitest (mocked client) — shape + blind contract assertions
  api-client/src/index.ts                             # re-export feed helpers
apps/web/
  app/feed/page.tsx                                  # RSC feed page (fetches via api-client)
  app/feed/EmptyFeedState.tsx                         # cold-start / exhausted-feed empty state
  app/api/feed/swipe/route.ts                          # thin POST → record_swipe RPC
  components/feed/FeedCard.tsx                          # one blind night card (client)
  components/feed/AmbientPlayer.tsx                     # native-first audio w/ explicit web fallback
  components/feed/SwipeDeck.tsx                          # client deck: swipe right/left → /api/feed/swipe
```

No production secrets touched. Types regenerate via `pnpm db:types` after SQL lands (Task 9).

---

## Task 1: Vitest runner + feed validators (shared contract)

Establish the TS test runner (if not already present from an earlier phase) and define the **single source of truth** for the feed card shape and swipe input. The card schema is the enforcement boundary: it has **no creator-identity field**, so any helper returning it is structurally blind.

**Files:**
- Create: `packages/validators/src/feed.ts`
- Modify: `packages/validators/src/index.ts`, `packages/validators/package.json`
- Create: `vitest.config.ts` (repo root, only if missing), `packages/validators/src/feed.test.ts`

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
      time_window_start: '2026-06-01T19:00:00.000Z',
      venue_neighborhood: 'Downtown',
      vibe_tags: ['romantic'],
      why_note: 'sunset wine on the lake',
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

- [ ] **Step 2: Run it, expect FAIL** — `pnpm --filter @after5/validators test` → cannot find `./feed`. (If vitest itself is missing, install it: `pnpm -w add -D vitest` and add `"test": "vitest run"` to each package's scripts; create root `vitest.config.ts` with `{ test: { environment: 'node' } }`.)

- [ ] **Step 3: Write the real code**

```ts
// packages/validators/src/feed.ts
import { z } from 'zod';

// The blind feed card. INTENTIONALLY contains no creator identity. This schema
// is the contract boundary: api-client returns exactly this, so the client is
// structurally incapable of seeing who made the night. (spec §5, §4 privacy)
export const FeedCardSchema = z.object({
  date_instance_id: z.string().uuid(),
  city_id: z.string().uuid(),
  time_window_start: z.string().datetime(),      // coarse (hour-truncated in P0 view)
  venue_neighborhood: z.string().nullable(),      // neighborhood only, never venue name
  vibe_tags: z.array(z.string()).default([]),
  why_note: z.string().nullable(),
  ambient_sound_url: z.string().url().nullable(),
  pay_setting: z.enum(['i_pay', 'they_pay', 'split']).nullable(),
  distance_m: z.number().nonnegative().nullable(), // viewer↔venue, from PostGIS
  is_seed: z.boolean().default(false),             // cold-start curated fallback marker
});
export type FeedCard = z.infer<typeof FeedCardSchema>;

export const FeedQuerySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().nullable().default(null), // last-seen date_instance_id
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
git add packages/validators/src/feed.ts packages/validators/src/index.ts packages/validators/package.json vitest.config.ts
git add packages/validators/src/feed.test.ts
git commit -m "P4: feed/swipe zod contract (blind card has no creator identity) + vitest"
```

---

## Task 2: Geo point on `date_instances` (real per-venue distance)

P0's `cities.centroid` is `geography`, but `places` carries `lat`/`lng` decimals and `date_instances` has no geo column — so a real per-venue distance filter has nothing to query. Add a `geo geography(Point,4326)` to `date_instances`, populate it on insert (venue point, falling back to city centroid), and index it for `ST_DWithin`.

**Files:**
- Create: `supabase/migrations/20260525130000_p4_date_instance_geo.sql`
- Test: `supabase/tests/p4_compat_prefilter.sql` (created here, asserts column + index; filtering logic asserted in Task 4)

- [ ] **Step 1: Write the failing test (structural slice)**

```sql
-- supabase/tests/p4_compat_prefilter.sql  (structural assertions; behavioral block appended in Task 4)
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
-- supabase/migrations/20260525130000_p4_date_instance_geo.sql
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
git add supabase/migrations/20260525130000_p4_date_instance_geo.sql supabase/tests/p4_compat_prefilter.sql
git commit -m "P4: date_instances.geo (venue point w/ city-centroid fallback) + GiST index"
```

---

## Task 3: Extend `browse_feed` with `distance_m` and pay/coarse fields (still blind)

P0's `browse_feed` already strips `creator_id`. The compatibility RPC (Task 4) needs to project `distance_m` for the viewer. Rather than recomputing geo in the view (it has no viewer context), keep the view identity-blind and additive: expose `pay_setting` (already present), `geo` is **not** exposed (raw coordinates would re-enable triangulation); instead the RPC joins `date_instances.geo` server-side. This task hardens the view: re-assert no identity columns and add the `is_seed` passthrough used by cold-start.

**Files:**
- Create: `supabase/migrations/20260525130100_p4_browse_feed_geo.sql`
- (Leak test lives in Task 5; this task just evolves the view.)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525130100_p4_browse_feed_geo.sql
-- Recreate browse_feed additively: same blind columns as P0 + is_seed passthrough.
-- Raw geo is deliberately NOT exposed (prevents triangulating the creator's venue
-- pre-lock, spec §4). Distance is computed inside the SECURITY DEFINER RPC instead.
alter table date_instances
  add column if not exists is_seed boolean not null default false;

create or replace view browse_feed
with (security_invoker = true) as
select
  di.id            as date_instance_id,
  di.city_id,
  date_trunc('hour', di.starts_at) as time_window_start,
  di.status,
  di.is_seed,
  i.id             as itinerary_id,
  i.pay_setting,
  i.vibe_tags,
  i.why_note,
  i.ambient_sound_url,
  p.neighborhood   as venue_neighborhood
from date_instances di
join itineraries i on i.id = di.itinerary_id
left join places p on p.id = di.venue_id
where di.status = 'seeking';

grant select on browse_feed to anon, authenticated;
```

- [ ] **Step 2: Apply, expect clean** — `supabase db reset`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525130100_p4_browse_feed_geo.sql
git commit -m "P4: browse_feed adds is_seed passthrough; geo kept server-side only (anti-triangulation)"
```

---

## Task 4: `browse_feed_for_viewer()` — server-side compatibility pre-filter

The heart of "blind ≠ unfiltered" (spec §5). A SECURITY DEFINER RPC that, for the calling viewer, returns blind feed cards **only** for instances whose creator is **mutually basic-compatible** — orientation/gender, age range, and PostGIS distance — without ever returning who the creator is. Mutuality is enforced both directions: the viewer's prefs must accept the creator AND the creator's prefs must accept the viewer (the night should only reach people the creator could match).

**Files:**
- Create: `supabase/migrations/20260525130200_p4_browse_feed_rpc.sql`
- Test: append behavioral block to `supabase/tests/p4_compat_prefilter.sql`

- [ ] **Step 1: Write the failing test (append behavioral block)**

```sql
-- supabase/tests/p4_compat_prefilter.sql  (append after the structural block from Task 2)
DO $$
DECLARE
  viewer uuid; far_cre uuid; near_ok uuid; wrong_gender uuid; out_of_age uuid;
  cid uuid; n int;
BEGIN
  insert into cities (slug,name,timezone,centroid,is_active) values
    ('pftest','pftest','UTC', ST_SetSRID(ST_MakePoint(-119.4960,49.8880),4326)::geography, true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='pftest';

  -- viewer: man, into women, 28, wants 25-35, 40km radius, in Kelowna centroid
  insert into profiles (id, first_name, gender, gender_preferences, age, age_pref, distance_pref_km, primary_city_id, dating_enabled, verification)
    values (gen_random_uuid(),'viewer','man','{woman}',28,'[25,35]',40,cid,true,'verified') returning id into viewer;

  -- near_ok: woman into men, 30, wants 26-32, same city → COMPATIBLE
  insert into profiles (id, first_name, gender, gender_preferences, age, age_pref, distance_pref_km, primary_city_id, dating_enabled, verification)
    values (gen_random_uuid(),'near','woman','{man}',30,'[26,32]',40,cid,true,'verified') returning id into near_ok;
  -- wrong_gender: man into men → viewer not interested in men AND creator not into viewer
  insert into profiles (id, first_name, gender, gender_preferences, age, age_pref, distance_pref_km, primary_city_id, dating_enabled, verification)
    values (gen_random_uuid(),'wg','man','{man}',30,'[26,32]',40,cid,true,'verified') returning id into wrong_gender;
  -- out_of_age: woman into men but age 50, outside viewer's 25-35
  insert into profiles (id, first_name, gender, gender_preferences, age, age_pref, distance_pref_km, primary_city_id, dating_enabled, verification)
    values (gen_random_uuid(),'oa','woman','{man}',50,'[26,40]',40,cid,true,'verified') returning id into out_of_age;
  -- far_cre: woman into men, 30, but ~3000km away → outside distance
  insert into profiles (id, first_name, gender, gender_preferences, age, age_pref, distance_pref_km, primary_city_id, dating_enabled, verification)
    values (gen_random_uuid(),'far','woman','{man}',30,'[26,32]',40,cid,true,'verified') returning id into far_cre;

  -- one seeking instance per creator; near & wrong & out_of_age at centroid, far_cre far away
  PERFORM mk_instance(near_ok, cid, -119.4960, 49.8880);
  PERFORM mk_instance(wrong_gender, cid, -119.4960, 49.8880);
  PERFORM mk_instance(out_of_age, cid, -119.4960, 49.8880);
  PERFORM mk_instance(far_cre, cid, -106.0000, 52.0000);  -- far point overrides city centroid via venue? use direct geo

  -- Call the RPC as the viewer (set local request.jwt claim to the viewer uuid)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer::text)::text, true);
  select count(*) into n from browse_feed_for_viewer(20, null);

  -- Only near_ok should pass all filters.
  IF n <> 1 THEN RAISE EXCEPTION 'pre-filter returned % rows, expected exactly 1 (near_ok only)', n; END IF;
  RAISE NOTICE 'compat pre-filter OK';
  ROLLBACK;
END $$;
```

> The test uses a tiny helper `mk_instance(creator, city, lng, lat)` that inserts an itinerary + a seeking `date_instance` whose `geo` is forced to the given point. Define it at the top of the test file:
> ```sql
> create or replace function mk_instance(p_cre uuid, p_city uuid, p_lng numeric, p_lat numeric)
> returns uuid language plpgsql as $$
> declare it uuid; di uuid; begin
>   insert into itineraries (id,user_id,pay_setting,vibe_tags,why_note)
>     values (gen_random_uuid(), p_cre, 'split', '{romantic}', 'why') returning id into it;
>   insert into date_instances (itinerary_id,creator_id,city_id,starts_at,geo)
>     values (it, p_cre, p_city, now()+interval '2 days',
>             ST_SetSRID(ST_MakePoint(p_lng,p_lat),4326)::geography) returning id into di;
>   return di;
> end $$;
> ```
> (The `before insert ... set geo` trigger from Task 2 would overwrite venue/centroid-derived geo, but here `venue_id` is null and we pass `geo` explicitly; adjust the trigger to **not** clobber a geo provided on insert — see migration note below.)

- [ ] **Step 2: Run it, expect FAIL** — `function browse_feed_for_viewer(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130200_p4_browse_feed_rpc.sql

-- Let an explicitly-provided geo survive (used by tests + future precise-venue inserts).
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
-- to compute the filter, while returning ONLY blind feed columns (+ distance).
create or replace function browse_feed_for_viewer(p_limit int default 20, p_cursor uuid default null)
returns table (
  date_instance_id uuid,
  city_id uuid,
  time_window_start timestamptz,
  venue_neighborhood text,
  vibe_tags text[],
  why_note text,
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
  select di.id, di.city_id, date_trunc('hour', di.starts_at),
         pl.neighborhood, i.vibe_tags, i.why_note, i.ambient_sound_url, i.pay_setting,
         case when v_geo is null then null else ST_Distance(di.geo, v_geo) end,
         di.is_seed
  from date_instances di
  join itineraries i on i.id = di.itinerary_id
  join profiles cp   on cp.id = di.creator_id     -- creator prefs (NOT returned)
  left join places pl on pl.id = di.venue_id
  where di.status = 'seeking'
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
    -- CURSOR (keyset by id; simple + deterministic for v1)
    and (p_cursor is null or di.id > p_cursor)
  order by di.is_seed asc, di.id asc      -- real nights before seed/curated fallback
  limit greatest(1, least(p_limit, 50));
end $fn$;

revoke all on function browse_feed_for_viewer(int, uuid) from public;
grant execute on function browse_feed_for_viewer(int, uuid) to authenticated;
```

> **Decision — mutual filter:** a hard filter both ways. If the viewer has *empty* `gender_preferences`/`age_pref` (not yet onboarded that field) the clause is permissive (`array_length(...) is null` → true) so the feed isn't accidentally empty; P1 should require these at onboarding. Orientation is modeled via `gender` + `gender_preferences` (P0/P1 fields) rather than a separate `orientation` enum.
> **Decision — distance:** `ST_DWithin(geo, viewer_centroid, radius_m)`. Distance is measured venue→viewer-city-centroid (viewer's precise location isn't stored server-side pre-native). When native ships precise location it can pass a viewer point; the RPC signature can gain an optional param later without breaking callers.

- [ ] **Step 4: Apply + run test, expect PASS** — prints `compat pre-filter OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130200_p4_browse_feed_rpc.sql supabase/tests/p4_compat_prefilter.sql
git commit -m "P4: browse_feed_for_viewer() server-side mutual compatibility pre-filter (blind)"
```

---

## Task 5: The identity-leak test (the trust-critical assertion)

A dedicated test proving the blind contract from two angles: (1) the `browse_feed` view exposes no identity column; (2) `browse_feed_for_viewer()`'s declared `RETURNS TABLE` signature contains no identity column and never selects `creator_id`. This is the audit's "RLS identity-leak risk" guard.

**Files:**
- Create: `supabase/tests/p4_feed_no_identity_leak.sql`

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/p4_feed_no_identity_leak.sql
DO $$
DECLARE banned text;
BEGIN
  -- (1) The view must not expose identity.
  FOR banned IN SELECT unnest(ARRAY['creator_id','user_id','full_name','email','phone','clear_photo_url']) LOOP
    PERFORM 1 FROM information_schema.columns
      WHERE table_name='browse_feed' AND column_name=banned;
    IF FOUND THEN RAISE EXCEPTION 'LEAK: browse_feed exposes %', banned; END IF;
  END LOOP;

  -- (2) The RPC return signature must not expose identity.
  FOR banned IN SELECT unnest(ARRAY['creator_id','user_id','full_name','email','phone','clear_photo_url']) LOOP
    PERFORM 1
      FROM pg_proc pr
      JOIN pg_type t ON t.oid = pr.prorettype
      , unnest(pr.proargnames) AS argname
     WHERE pr.proname = 'browse_feed_for_viewer'
       AND argname = banned;
    IF FOUND THEN RAISE EXCEPTION 'LEAK: browse_feed_for_viewer returns/takes %', banned; END IF;
  END LOOP;

  -- (3) Source-text guard: the function body must not reference creator identity columns in its target list.
  PERFORM 1 FROM pg_proc
   WHERE proname='browse_feed_for_viewer'
     AND prosrc ILIKE '%di.creator_id,%';   -- creator_id appearing in a SELECT list
  IF FOUND THEN RAISE EXCEPTION 'LEAK: browse_feed_for_viewer selects creator_id into output'; END IF;

  RAISE NOTICE 'no-identity-leak OK';
END $$;
```

- [ ] **Step 2: Run it, expect PASS** (the view + RPC already comply from Tasks 3–4). If it fails, a prior task leaked identity — fix there.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/p4_feed_no_identity_leak.sql
git commit -m "P4: identity-leak test — feed view + RPC never return creator identity"
```

---

## Task 6: `record_swipe()` — idempotent swipe RPC

Swipe right/left, written once per `(swiper, instance)` (P0's unique index). Idempotent: re-calling with the same instance **updates the direction** (a user can change their mind right→left) and never errors or duplicates. The RPC also enforces that the instance is real and `seeking`, and that the swiper isn't the creator.

**Files:**
- Create: `supabase/migrations/20260525130300_p4_record_swipe_rpc.sql`
- Test: `supabase/tests/p4_record_swipe_idempotent.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p4_record_swipe_idempotent.sql
DO $$
DECLARE cre uuid; viewer uuid; cid uuid; inst uuid; n int; dir swipe_direction;
BEGIN
  insert into cities (slug,name,timezone,is_active) values ('sw','sw','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='sw';
  insert into profiles (id,first_name,dating_enabled) values (gen_random_uuid(),'c',true) returning id into cre;
  insert into profiles (id,first_name,dating_enabled) values (gen_random_uuid(),'v',true) returning id into viewer;
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
-- supabase/migrations/20260525130300_p4_record_swipe_rpc.sql
create or replace function record_swipe(p_instance uuid, p_direction swipe_direction)
returns void
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid := auth.uid(); v_creator uuid; v_status date_match_status;
begin
  if v_id is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  select creator_id, status into v_creator, v_status from date_instances where id = p_instance;
  if v_creator is null then raise exception 'instance_not_found' using errcode='P0002'; end if;
  if v_creator = v_id then raise exception 'cannot_swipe_own_night' using errcode='42501'; end if;
  if v_status <> 'seeking' then raise exception 'instance_not_open' using errcode='22023'; end if;

  insert into swipes (swiper_id, date_instance_id, creator_id, direction)
  values (v_id, p_instance, v_creator, p_direction)
  on conflict (swiper_id, date_instance_id)
  do update set direction = excluded.direction;  -- idempotent: change-of-mind updates
end $fn$;

revoke all on function record_swipe(uuid, swipe_direction) from public;
grant execute on function record_swipe(uuid, swipe_direction) to authenticated;
```

> P0's `swipes` insert policy is `swiper_id = auth.uid()`; SECURITY DEFINER bypasses RLS but the RPC sets `swiper_id := auth.uid()` itself, so it cannot forge a swipe for another user. The `on conflict … do update` makes this the single idempotent write path (the audit's "idempotency" concern for interest).

- [ ] **Step 4: Apply + run test, expect PASS** — prints `record_swipe idempotent OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130300_p4_record_swipe_rpc.sql supabase/tests/p4_record_swipe_idempotent.sql
git commit -m "P4: record_swipe() idempotent RPC (one row per swiper/instance, change-of-mind updates)"
```

---

## Task 7: Cold-start / empty-feed strategy (seed content + fallback)

A thin market means a logged-in compatible user can legitimately exhaust the real feed. Concrete strategy, ordered:

1. **Real compatible nights first** (Task 4 already orders `is_seed asc`).
2. **Curated seed nights** — a small set of `is_seed=true` `date_instances` owned by a system "concierge" profile, representing high-quality example nights for the active city. They are real `seeking` instances so the *exact same* swipe/feed code path works; a right-swipe on a seed night routes to a concierge-handled flow (out of scope here — P5 decides; for P4 it simply records the swipe and shows a "we'll line up a real match" confirmation).
3. **Explicit empty state** when even seed content is exhausted: a designed `EmptyFeedState` that (a) explains the market is young, (b) routes the user to *create* a night (supply begets demand — symmetric marketplace, spec §2), (c) offers to notify when new compatible nights post.

This task delivers the **seed data + the `is_seed` semantics**; the empty-state UI lands in Task 8/8b.

**Files:**
- Create: `supabase/migrations/20260525130400_p4_feed_seed.sql`
- Test: `supabase/tests/p4_cold_start.sql`
- Create pure helper: `packages/business/src/compat.ts` (cold-start tier function) + `packages/business/src/compat.test.ts`

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/p4_cold_start.sql
DO $$
DECLARE viewer uuid; cid uuid; n_real int; n_seed int;
BEGIN
  select id into cid from cities where slug='kelowna';
  IF cid IS NULL THEN RAISE EXCEPTION 'kelowna seed missing (P0)'; END IF;

  insert into profiles (id,first_name,gender,gender_preferences,age,age_pref,distance_pref_km,primary_city_id,dating_enabled,verification)
    values (gen_random_uuid(),'cs','man','{woman,man,nonbinary}',30,'[18,99]',500,cid,true,'verified') returning id into viewer;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer::text)::text, true);
  select count(*) filter (where not is_seed), count(*) filter (where is_seed)
    into n_real, n_seed from browse_feed_for_viewer(50,null);

  -- With no real compatible nights, seed nights must carry the feed.
  IF n_seed < 1 THEN RAISE EXCEPTION 'cold-start: no seed nights surfaced (got % seed)', n_seed; END IF;
  RAISE NOTICE 'cold-start OK (real=%, seed=%)', n_real, n_seed;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `cold-start: no seed nights surfaced`.

- [ ] **Step 3: Write the migration (concierge profile + ≥3 seed nights for Kelowna)**

```sql
-- supabase/migrations/20260525130400_p4_feed_seed.sql
-- Deterministic system "concierge" profile that owns curated cold-start nights.
-- Fixed UUID so re-running is idempotent. dating_enabled + permissive prefs so it
-- passes the mutual filter for any onboarded viewer.
insert into profiles (id, first_name, gender, gender_preferences, age, age_pref,
                      distance_pref_km, primary_city_id, dating_enabled, verification)
select '00000000-0000-0000-0000-0000000c0nc'::uuid, 'After5', null, '{woman,man,nonbinary}',
       30, '[18,99]', 1000, c.id, true, 'verified'
from cities c where c.slug='kelowna'
on conflict (id) do update set dating_enabled = true;

-- Three curated seed nights (evergreen itineraries + seeking instances), Kelowna.
do $$
declare cid uuid; conc uuid := '00000000-0000-0000-0000-0000000c0nc'::uuid;
        it uuid; specs jsonb := '[
          {"vibe":["romantic","cozy"],"why":"Sunset wine flight on a lakeside patio.","amb":"https://cdn.tryafter5.app/ambient/lake-evening.mp3","nb":"Downtown"},
          {"vibe":["adventurous","fun"],"why":"Golden-hour hike then tacos in the orchard.","amb":"https://cdn.tryafter5.app/ambient/orchard-birds.mp3","nb":"Mission"},
          {"vibe":["chill","intimate"],"why":"Vinyl bar, low light, two cocktails, no rush.","amb":"https://cdn.tryafter5.app/ambient/vinyl-bar.mp3","nb":"Pandosy"}
        ]'::jsonb;
        s jsonb;
begin
  select id into cid from cities where slug='kelowna';
  for s in select * from jsonb_array_elements(specs) loop
    insert into itineraries (id,user_id,pay_setting,vibe_tags,why_note,ambient_sound_url)
      values (gen_random_uuid(), conc, 'split',
              array(select jsonb_array_elements_text(s->'vibe')),
              s->>'why', s->>'amb')
      returning id into it;
    insert into date_instances (itinerary_id,creator_id,city_id,starts_at,status,is_seed)
      values (it, conc, cid, now()+interval '7 days', 'seeking', true);
  end loop;
end $$;
```

> **Decision — seed as real rows, not a separate path:** seed nights are ordinary `seeking` instances flagged `is_seed`, so the feed, swipe, and leak tests all exercise the identical code. The only difference is ordering (real first) and the client badge/empty-state copy. Concierge identity is still blind in the feed (same view/RPC).

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
git add supabase/migrations/20260525130400_p4_feed_seed.sql supabase/tests/p4_cold_start.sql
git add packages/business/src/compat.ts packages/business/src/compat.test.ts packages/business/src/index.ts
git commit -m "P4: cold-start strategy — concierge seed nights + feedTier/isHardCompatible helpers"
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
        time_window_start: '2026-06-01T19:00:00.000Z',
        venue_neighborhood: 'Downtown', vibe_tags: ['romantic'],
        why_note: 'x', ambient_sound_url: null, pay_setting: 'split',
        distance_m: 1000, is_seed: false,
        creator_id: 'LEAKED-SHOULD-BE-STRIPPED',   // hostile row
      }],
      error: null,
    }));
    const cards = await browseFeed(client, { limit: 20, cursor: null });
    expect(cards).toHaveLength(1);
    expect((cards[0] as any).creator_id).toBeUndefined();   // stripped at boundary
    expect(client.rpc).toHaveBeenCalledWith('browse_feed_for_viewer', { p_limit: 20, p_cursor: null });
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
export async function browseFeed(client: After5Client, query: FeedQuery): Promise<FeedCard[]> {
  const q = FeedQuerySchema.parse(query);
  const { data, error } = await (client as any).rpc('browse_feed_for_viewer', {
    p_limit: q.limit, p_cursor: q.cursor,
  });
  if (error) throw error;
  return (data ?? []).map((row: unknown) => FeedCardSchema.parse(row));
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

## Task 9: Regenerate types + web feed page, card, swipe deck, empty state, swipe route

Wire the web surface as a thin RSC over `api-client`. The page fetches the feed server-side, renders the deck client component which posts swipes to a thin route that calls the RPC. Empty/seed states come from `feedTier`.

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)
- Create: `apps/web/app/feed/page.tsx`, `apps/web/app/feed/EmptyFeedState.tsx`,
  `apps/web/components/feed/FeedCard.tsx`, `apps/web/components/feed/SwipeDeck.tsx`,
  `apps/web/app/api/feed/swipe/route.ts`

- [ ] **Step 1: Regenerate types** — `supabase db reset && pnpm db:types`. Expect `browse_feed_for_viewer`, `record_swipe`, `date_instances.geo`, `date_instances.is_seed` to appear.

- [ ] **Step 2: Swipe route (thin POST → RPC)**

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
  const cards = await browseFeed(supabase as any, { limit: 20, cursor: null });
  const tier = feedTier(cards);
  return (
    <main className="mx-auto max-w-content px-6 py-10">
      {tier === 'empty'
        ? <EmptyFeedState variant="exhausted" />
        : <>
            {tier === 'seed_only' && <EmptyFeedState variant="seed_only" />}
            <SwipeDeck initialCards={cards} />
          </>}
    </main>
  );
}
```

```tsx
// apps/web/app/feed/EmptyFeedState.tsx
import Link from 'next/link';
export function EmptyFeedState({ variant }: { variant: 'exhausted' | 'seed_only' }) {
  const copy = variant === 'exhausted'
    ? { h: "You're all caught up.", p: "The Kelowna scene is young — the fastest way to get a match is to post a night of your own. People swipe on the night, not the face." }
    : { h: "A few curated nights to start.", p: "More real nights are posting every week. Want to seed the scene? Create your own night." };
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
// apps/web/components/feed/SwipeDeck.tsx
'use client';
import { useState } from 'react';
import type { FeedCard } from '@after5/validators';
import { FeedCard as Card } from './FeedCard';

export function SwipeDeck({ initialCards }: { initialCards: FeedCard[] }) {
  const [cards, setCards] = useState(initialCards);
  const [busy, setBusy] = useState(false);
  if (cards.length === 0) return <p className="text-secondary">No more nights right now.</p>;
  const top = cards[0];
  const swipe = async (direction: 'right' | 'left') => {
    if (busy) return; setBusy(true);
    try {
      await fetch('/api/feed/swipe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date_instance_id: top.date_instance_id, direction }),
      });
      setCards((c) => c.slice(1));   // advance regardless (idempotent server-side)
    } finally { setBusy(false); }
  };
  return (
    <div>
      <Card card={top} />
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

```tsx
// apps/web/components/feed/FeedCard.tsx
import type { FeedCard as FeedCardT } from '@after5/validators';
import { AmbientPlayer } from './AmbientPlayer';

export function FeedCard({ card }: { card: FeedCardT }) {
  const when = new Date(card.time_window_start);
  const km = card.distance_m != null ? `${(card.distance_m / 1000).toFixed(1)} km away` : null;
  return (
    <article className="rounded-2xl border border-border p-6">
      {card.is_seed && <span className="text-[11px] uppercase tracking-wide text-muted">Curated</span>}
      <p className="text-xs text-muted">{card.venue_neighborhood ?? 'Kelowna'} · {when.toLocaleDateString(undefined,{ weekday:'long' })} evening</p>
      <p className="mt-3 text-lg text-text">{card.why_note}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {card.vibe_tags.map((v) => <span key={v} className="rounded-pill bg-surface px-3 py-1 text-xs">{v}</span>)}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-secondary">
        <span>{card.pay_setting === 'split' ? '50-50' : card.pay_setting === 'i_pay' ? 'They treat' : 'Your treat'}</span>
        {km && <span>{km}</span>}
      </div>
      <div className="mt-4"><AmbientPlayer src={card.ambient_sound_url} label={card.vibe_tags[0]} /></div>
    </article>
  );
}
```

- [ ] **Step 4: Typecheck the web app** — `pnpm typecheck`. Expect clean. (No headless browser test in P4; visual/a11y polish is P11.)

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts apps/web/app/feed apps/web/components/feed/FeedCard.tsx apps/web/components/feed/SwipeDeck.tsx apps/web/app/api/feed/swipe/route.ts
git commit -m "P4: web feed page (RSC via api-client) + swipe deck/route + cold-start empty states + types"
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

**Spec coverage (vs roadmap P4 'Closes' list):**
- **Blind feed via P0 `browse_feed`** → Task 3 evolves the view additively (still no identity); Task 4 RPC returns only blind columns + distance. ✅
- **Blind ≠ unfiltered / "filter quality = trust dependency"** → Task 4 mutual compatibility pre-filter (orientation via gender+gender_preferences, age range both ways, PostGIS distance), with a pure mirror `isHardCompatible` unit-tested in Task 7. ✅
- **PostGIS distance (cities.centroid + distance_pref_km)** → Task 2 adds real `date_instances.geo`; Task 4 uses `ST_DWithin(geo, viewer_city_centroid, radius_m)`. ✅
- **Swipe RIGHT/LEFT, idempotent, one per swiper/instance** → Task 6 `record_swipe()` with `on conflict do update`; test proves no duplicate + change-of-mind. ✅
- **Ambient playback native-first + explicit web fallback** → Task 8b `AmbientPlayer` never autoplays on web, gesture-gated, text caption, graceful `.catch`. ✅
- **Cold-start / empty-feed strategy (concrete behavior + empty state)** → Task 7 concierge seed nights (`is_seed`, real `seeking` rows) ordered after real nights; Task 9 `feedTier` → `EmptyFeedState` (exhausted vs seed_only) routing to "create a night." ✅
- **Test that the feed never returns creator identity** → Task 5 `p4_feed_no_identity_leak.sql` (view columns + RPC signature + body source guard) + Task 8 boundary parse drops leaked fields. ✅
- **API-first (logic in shared so native reuses it)** → all query/swipe/tier logic in `api-client`/`business`/`validators`; web is a thin RSC + route (spec §10). ✅

**Conventions vs P0:** migration naming band `20260525130x00`; idempotent policies pattern reused where tables are touched (none new in P4 — only view/RPC/columns/seed); SECURITY DEFINER funcs pin `search_path`; psql `DO $$…$$` tests; vitest for TS. ✅

**Decisions / assumptions made explicit:**
1. **Orientation modeled as `gender` + `gender_preferences text[]`** (the P0/P1 columns), not a separate `orientation` enum. The mutual filter requires both directions to accept.
2. **Distance measured venue→viewer-city-centroid.** Viewer's precise location is not stored server-side pre-native; the RPC signature can later take an optional viewer point without breaking web callers (additive param).
3. **`date_instances.geo` added in P4** (P0 had none) — venue point with city-centroid fallback, so every seeking night is distance-rankable; explicit-geo-on-insert is respected (for tests/precise venues).
4. **Empty/permissive prefs are permissive in the filter** (so a half-onboarded user isn't shown an empty feed); P1 should make orientation/age prefs required at onboarding. Flagged as a P1 dependency.
5. **Cold-start = real concierge seed rows, not a separate code path** — guarantees the leak/swipe/feed tests cover the exact production path; a right-swipe on a seed night is recorded normally, with the concierge-match resolution deferred to P5.
6. **No new chat/notification/match surface** (P5/P6); right-swipe only writes a `swipe`. The "you matched" / shortlist consequence is P5.
7. **Anti-triangulation:** raw `geo` is never exposed to the client; only a rounded `distance_m` and a coarse hour-truncated time + neighborhood (spec §4 pre-lock privacy). A future task could bucket `distance_m` further if even meters re-enable triangulation.

**Deferred to later phases (intentionally NOT in P4):** shortlist/rank/offer/lock (P5); reciprocal-pair detection (P5); the concierge-match resolution for seed-night swipes (P5); demand hints (P5); chat at offer (P6); push notifications for new compatible nights (P2); accessibility audit + analytics events on swipe (P11); precise native location capture (native build).

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. Ambient CDN URLs in the seed are illustrative `cdn.tryafter5.app/ambient/*.mp3` paths owned by P3's media pipeline; if P3's library uses different paths, the seed migration's three URLs are the only thing to update.

**Type/name consistency:** `browse_feed_for_viewer(int,uuid)`, `record_swipe(uuid, swipe_direction)`, `date_instances.geo`/`.is_seed`, `FeedCardSchema`/`SwipeInputSchema`, `browseFeed`/`recordSwipe`, `feedTier`/`isHardCompatible` are referenced consistently across SQL, validators, business, api-client, and web.

**Risk note:** the SQL behavioral tests set `request.jwt.claims.sub` via `set_config` to simulate `auth.uid()` inside SECURITY DEFINER RPCs; this is the standard local-psql technique and matches how P0 defers full RLS-policy behavior to app integration tests. The leak test additionally inspects `pg_proc.prosrc` as a belt-and-suspenders source guard.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p4-browse-feed.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session using executing-plans, with checkpoints at Task 5 (leak gate) and Task 10 (verification gate).
