# Phase 5a — Post & Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is the discovery half of the experience-first loop — DB invariants live in Postgres and are proven by psql tests; do not skip the FAIL step.

**Goal:** A verified, dating-enabled user posts a night (an owned/public itinerary + a future time) and other *compatible* users browse it in a blind, identity-stripped feed and swipe — producing the `swipes` data that Phase 5b turns into matches.

**Architecture:** DB-first. The compatibility pre-filter and the blind projection live in `SECURITY DEFINER` RPCs (`post_night`, `browse_feed_for_viewer`, `record_swipe`) that derive the actor from `auth.uid()` (Contract C10) — no Edge Functions. Identity-blindness is enforced in the DB (the feed RPC never returns `creator_id`), proven by a psql leak test. Typed helpers in `packages/api-client`; cold-start tiering is a pure function in `packages/business`; web renders RSC pages (`/feed`, `/nights/new`) that fetch through `api-client` with thin client components for swipe + post.

**Tech Stack:** Supabase Postgres + PostGIS (`ST_DWithin` on `geography`), SQL migrations, RLS + SECURITY DEFINER RPCs, psql invariant/leak tests (`supabase/tests/`, run by `pnpm db:test`), `packages/{api-client,business,validators}` (TS), vitest, Next.js App Router + the existing `createClient()` server helper.

**Source spec:** `docs/superpowers/specs/2026-05-27-loop-5a-post-and-browse-design.md`. **Authority:** `INTEGRATION-CONTRACT.md` v2.1 (C4, C7, C8, C10, C11.3, C11.8) > `RECONCILED-MASTER-PLAN.md` (S5) > this plan.

---

## File Map

**Migrations** (`supabase/migrations/`, sort after S1–S3; dated `20260527*`):
- `20260527120000_s4_date_instances_feed_columns.sql` — add `moderation_status` enum+column (default `approved`) + `is_seed` boolean to `date_instances`.
- `20260527120100_s5_record_swipe.sql` — `record_swipe(p_instance, p_direction)` RPC.
- `20260527120200_s5_post_night.sql` — `post_night(p_itinerary, p_starts_at, p_venue, p_duration_min)` RPC + the date_instances INSERT RLS policy.
- `20260527120300_s5_browse_feed.sql` — `browse_feed_for_viewer(p_viewer, p_point, p_after_starts, p_after_id, p_limit)` RPC + the `feed_row` composite type.

**psql tests** (`supabase/tests/`, each `\i supabase/tests/_fixtures.sql`):
- `s5_record_swipe.sql` — idempotency + creator_id denormalization + actor from JWT.
- `s5_post_night.sql` — guards (past time, non-owned/non-public itinerary, unverified caller) + happy path.
- `s5_browse_feed_blind.sql` — projection has no identity column; RLS can't back-derive creator.
- `s5_browse_feed_compat.sql` — mutual gender/age/distance filter; excludes self + already-swiped + non-approved + past.

**TS packages:**
- `packages/business/src/feedColdStart.ts` (+ `__tests__/feedColdStart.test.ts`) — pure `feedColdStartTier`.
- `packages/business/src/index.ts` — re-export.
- `packages/validators/src/feed.ts` (+ re-export in its index) — `PostNightInput` zod schema.
- `packages/api-client/src/feed.ts` (+ re-export in `src/index.ts`) — `postNight`, `browseFeed`, `recordSwipe`.
- `packages/types/src/database.ts` — regenerated after migrations (`pnpm db:types`).

**Web** (`apps/web/`):
- `app/nights/new/page.tsx` (RSC gate) + `app/nights/new/PostNightForm.tsx` (client).
- `app/feed/page.tsx` (RSC fetch) + `app/feed/SwipeDeck.tsx` (client) + `app/feed/NightCard.tsx`.
- `lib/after5/client.ts` — re-export the new helpers (follows the existing pattern).
- `app/home/FirstSessionHome.tsx` (or the home entry component) — add the `/feed` + `/nights/new` entry for dating-enabled users.

---

## Task 0: Feed columns on `date_instances`

**Files:**
- Create: `supabase/migrations/20260527120000_s4_date_instances_feed_columns.sql`
- Test: `supabase/tests/s5_browse_feed_compat.sql` (covers the columns indirectly; a dedicated assertion is added in Step 1)

- [ ] **Step 1: Write the failing test** — `supabase/tests/s5_feed_columns.sql`

```sql
-- supabase/tests/s5_feed_columns.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE n int;
BEGIN
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='date_instances'
     and column_name in ('moderation_status','is_seed');
  IF n <> 2 THEN RAISE EXCEPTION 'expected moderation_status + is_seed on date_instances, found %', n; END IF;
  -- default approved + is_seed false
  PERFORM 1 from pg_attrdef d join pg_class c on c.oid=d.adrelid
    join pg_attribute a on a.attrelid=c.oid and a.attnum=d.adnum
    where c.relname='date_instances' and a.attname='moderation_status';
  RAISE NOTICE 's5_feed_columns OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/s5_feed_columns.sql`
Expected: FAIL — `expected moderation_status + is_seed on date_instances, found 0`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260527120000_s4_date_instances_feed_columns.sql
-- Minimal S4 columns the S5 feed depends on (Contract C11.8). moderation_status
-- default 'approved' because these first nights + concierge seeds are non-UGC.
do $$ begin
  create type moderation_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

alter table date_instances
  add column if not exists moderation_status moderation_status not null default 'approved',
  add column if not exists is_seed boolean not null default false;

create index if not exists date_instances_feed_idx
  on date_instances (status, starts_at)
  where status='seeking' and moderation_status='approved';
```

- [ ] **Step 4: Apply + run the test to verify it passes**

Run: `supabase migration up` (or `psql ... -f supabase/migrations/20260527120000_s4_date_instances_feed_columns.sql`) then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/s5_feed_columns.sql`
Expected: PASS — `s5_feed_columns OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260527120000_s4_date_instances_feed_columns.sql supabase/tests/s5_feed_columns.sql
git commit -m "feat(s5): add moderation_status + is_seed columns to date_instances"
```

---

## Task 1: `record_swipe` RPC

**Files:**
- Create: `supabase/migrations/20260527120100_s5_record_swipe.sql`
- Test: `supabase/tests/s5_record_swipe.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/s5_record_swipe.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; n int;
BEGIN
  cre := mk_user('creator'); usr := mk_user('swiper');
  itin := mk_itinerary(cre); inst := mk_instance(itin, cre, now()+interval '3 days');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);

  perform record_swipe(inst, 'right');
  perform record_swipe(inst, 'right');               -- idempotent: second is a no-op
  perform record_swipe(inst, 'left');                -- swipe is final: must NOT flip to left

  reset role;
  select count(*) into n from swipes where swiper_id=usr and date_instance_id=inst;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 swipe row, got %', n; END IF;
  PERFORM 1 from swipes where swiper_id=usr and date_instance_id=inst
    and direction='right' and creator_id=cre;
  IF NOT FOUND THEN RAISE EXCEPTION 'swipe row wrong: direction not right or creator_id not denormalized'; END IF;
  RAISE NOTICE 's5_record_swipe OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/s5_record_swipe.sql`
Expected: FAIL — `function record_swipe(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260527120100_s5_record_swipe.sql
-- Idempotent swipe write. Actor = auth.uid() (C10). creator_id denormalized from
-- the instance (the swiper never sees it). A swipe is final: re-swipe is a no-op.
create or replace function record_swipe(p_instance uuid, p_direction swipe_direction)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_creator uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select creator_id into v_creator from date_instances where id = p_instance;
  if v_creator is null then raise exception 'no such date instance' using errcode='P0002'; end if;
  if v_creator = v_actor then raise exception 'cannot swipe your own night' using errcode='P0001'; end if;
  insert into swipes (swiper_id, date_instance_id, creator_id, direction)
  values (v_actor, p_instance, v_creator, p_direction)
  on conflict (swiper_id, date_instance_id) do nothing;
end $fn$;
revoke execute on function record_swipe(uuid, swipe_direction) from public;
grant execute on function record_swipe(uuid, swipe_direction) to authenticated;
```

- [ ] **Step 4: Apply + run the test to verify it passes**

Run: apply the migration, then `psql ... -f supabase/tests/s5_record_swipe.sql`
Expected: PASS — `s5_record_swipe OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260527120100_s5_record_swipe.sql supabase/tests/s5_record_swipe.sql
git commit -m "feat(s5): record_swipe RPC (idempotent, actor from auth.uid)"
```

---

## Task 2: `post_night` RPC + INSERT RLS

**Files:**
- Create: `supabase/migrations/20260527120200_s5_post_night.sql`
- Test: `supabase/tests/s5_post_night.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/s5_post_night.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; other uuid; mine uuid; pub uuid; theirs uuid; inst uuid;
BEGIN
  cre := mk_user('creator'); other := mk_user('other');
  -- creator is verified + dating-enabled (post_night requires it)
  update profiles set dating_enabled=true, verification='verified' where id=cre;
  mine := mk_itinerary(cre);
  theirs := mk_itinerary(other);                 -- not owned by creator, not public
  pub := mk_itinerary(other); update itineraries set is_public=true where id=pub;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);

  -- happy path: own itinerary, future time
  inst := post_night(mine, now()+interval '5 days', null, 150);
  PERFORM 1 from date_instances where id=inst and creator_id=cre and status='seeking';
  IF NOT FOUND THEN RAISE EXCEPTION 'post_night did not create a seeking instance for the creator'; END IF;

  -- public itinerary is allowed
  PERFORM post_night(pub, now()+interval '5 days', null, 150);

  -- guard: past time
  BEGIN PERFORM post_night(mine, now()-interval '1 day', null, 150);
    RAISE EXCEPTION 'past starts_at should have been rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL; END;

  -- guard: itinerary not owned + not public
  BEGIN PERFORM post_night(theirs, now()+interval '5 days', null, 150);
    RAISE EXCEPTION 'foreign private itinerary should have been rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL; END;

  reset role;
  -- guard: unverified creator
  update profiles set verification='unverified' where id=cre;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);
  BEGIN PERFORM post_night(mine, now()+interval '5 days', null, 150);
    RAISE EXCEPTION 'unverified creator should have been rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL; END;
  reset role;

  RAISE NOTICE 's5_post_night OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `psql ... -f supabase/tests/s5_post_night.sql`
Expected: FAIL — `function post_night(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260527120200_s5_post_night.sql
-- A verified, dating-enabled user turns an owned-or-public itinerary into a
-- seeking night. status is RPC-only (C7); direct INSERT is still RLS-gated to
-- the creator as defense-in-depth, but status/moderation default safely.
create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_city uuid; v_ok boolean; v_id uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
  if p_starts_at <= now() then raise exception 'starts_at must be in the future' using errcode='P0001'; end if;

  select (dating_enabled and verification='verified'), primary_city_id
    into v_ok, v_city from profiles where id = v_actor;
  if not coalesce(v_ok,false) then
    raise exception 'must be verified and dating-enabled to post a night' using errcode='P0001';
  end if;
  if v_city is null then raise exception 'no primary city set' using errcode='P0001'; end if;

  select true into v_ok from itineraries
    where id = p_itinerary and (user_id = v_actor or is_public = true) limit 1;
  if not coalesce(v_ok,false) then
    raise exception 'itinerary not found or not yours' using errcode='P0001';
  end if;

  insert into date_instances (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status)
  values (p_itinerary, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking')
  returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function post_night(uuid, timestamptz, uuid, int) from public;
grant execute on function post_night(uuid, timestamptz, uuid, int) to authenticated;

-- Defense-in-depth: a direct INSERT (bypassing the RPC) must still be the caller's own.
do $$ begin
  create policy "date_instances_owner_insert" on date_instances for insert
    to authenticated with check (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
-- Owner can read their own nights (creator-side surfaces in 5b). Browsers use the RPC only.
do $$ begin
  create policy "date_instances_owner_select" on date_instances for select
    to authenticated using (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run the test to verify it passes**

Run: apply migration, then `psql ... -f supabase/tests/s5_post_night.sql`
Expected: PASS — `s5_post_night OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260527120200_s5_post_night.sql supabase/tests/s5_post_night.sql
git commit -m "feat(s5): post_night RPC + owner INSERT/SELECT RLS"
```

---

## Task 3: `browse_feed_for_viewer` RPC (blind + compatibility pre-filter)

**Files:**
- Create: `supabase/migrations/20260527120300_s5_browse_feed.sql`
- Test: `supabase/tests/s5_browse_feed_blind.sql`, `supabase/tests/s5_browse_feed_compat.sql`

- [ ] **Step 1: Write the blind-leak test**

```sql
-- supabase/tests/s5_browse_feed_blind.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; cols text;
BEGIN
  cre := mk_user('creator'); usr := mk_user('viewer');
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(25,40), distance_pref_km=50, primary_city_id=(select id from cities where slug='kelowna'),
    dating_enabled=true, verification='verified' where id=cre;
  update profiles set gender='woman', gender_preferences=array['man'], age=30,
    age_pref=int4range(25,40), distance_pref_km=50, primary_city_id=(select id from cities where slug='kelowna'),
    dating_enabled=true, verification='verified' where id=usr;
  itin := mk_itinerary(cre); inst := mk_instance(itin, cre, now()+interval '3 days');
  update date_instances set moderation_status='approved' where id=inst;

  -- The function's returned column set must NOT include creator identity.
  select string_agg(lower(name), ',') into cols
   from (select unnest(a.proargnames) as name, generate_subscripts(a.proargmodes,1) i
         from pg_proc a where a.proname='browse_feed_for_viewer') s
   where a.proargmodes is null;  -- fallback below if introspection differs
  -- Stronger: actually call it and check the row shape has no creator_id.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);
  CREATE TEMP TABLE _feed AS SELECT * FROM browse_feed_for_viewer(usr, null, null, null, 20);
  reset role;
  PERFORM 1 from information_schema.columns
    where table_name='_feed' and column_name in ('creator_id','creator','first_name','email');
  IF FOUND THEN RAISE EXCEPTION 'feed leaks creator identity column'; END IF;
  PERFORM 1 from _feed where date_instance_id=inst;
  IF NOT FOUND THEN RAISE EXCEPTION 'compatible night missing from feed'; END IF;
  DROP TABLE _feed;
  RAISE NOTICE 's5_browse_feed_blind OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Write the compatibility/exclusion test**

```sql
-- supabase/tests/s5_browse_feed_compat.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE kel uuid; cre uuid; viewer uuid; bad uuid; itin uuid; itin2 uuid; inst uuid; inst_bad uuid; past uuid; n int;
BEGIN
  select id into kel from cities where slug='kelowna';
  cre := mk_user('cre'); viewer := mk_user('viewer'); bad := mk_user('incompat');
  update profiles set gender='man', gender_preferences=array['woman'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, dating_enabled=true, verification='verified' where id=cre;
  update profiles set gender='woman', gender_preferences=array['man'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, dating_enabled=true, verification='verified' where id=viewer;
  update profiles set gender='woman', gender_preferences=array['woman'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel where id=bad;  -- viewer is 'man'-seeking-incompatible for bad

  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '3 days');                 -- compatible, future
  past := mk_instance(itin, cre, now()-interval '1 day');                  -- past → excluded
  itin2 := mk_itinerary(bad);
  inst_bad := mk_instance(itin2, bad, now()+interval '3 days');            -- incompatible creator → excluded

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);

  select count(*) into n from browse_feed_for_viewer(viewer, null, null, null, 50) where date_instance_id=inst;
  IF n<>1 THEN RAISE EXCEPTION 'compatible future night should appear exactly once (got %)', n; END IF;
  select count(*) into n from browse_feed_for_viewer(viewer, null, null, null, 50) where date_instance_id in (past, inst_bad);
  IF n<>0 THEN RAISE EXCEPTION 'past or incompatible nights leaked into feed (got %)', n; END IF;

  -- after swiping, the night drops out
  perform record_swipe(inst, 'left');
  select count(*) into n from browse_feed_for_viewer(viewer, null, null, null, 50) where date_instance_id=inst;
  IF n<>0 THEN RAISE EXCEPTION 'already-swiped night still in feed'; END IF;
  reset role;
  RAISE NOTICE 's5_browse_feed_compat OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 3: Run both to verify they fail**

Run: `psql ... -f supabase/tests/s5_browse_feed_blind.sql` and `... s5_browse_feed_compat.sql`
Expected: FAIL — `function browse_feed_for_viewer(...) does not exist`.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20260527120300_s5_browse_feed.sql
-- Blind, mutually-compatible, future, approved feed. Identity is never projected
-- (Contract C4/C11.3). Keyset pagination on (starts_at, id). Actor = auth.uid().
create or replace function browse_feed_for_viewer(
  p_viewer uuid default auth.uid(),
  p_point geography default null,
  p_after_starts timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 20
) returns table (
  date_instance_id uuid, city_id uuid, time_window_start timestamptz,
  itinerary_id uuid, pay_setting text, vibe_tags text[], why_note text,
  cover_image_url text, title text, venue_neighborhood text, is_seed boolean, distance_m double precision
) language sql security definer set search_path = public, extensions as $fn$
  with me as (
    select gender, gender_preferences, age, age_pref, distance_pref_km,
           coalesce(p_point, (select centroid from cities c where c.id = pr.primary_city_id)) as pt
    from profiles pr where pr.id = p_viewer
  )
  select di.id, di.city_id, date_trunc('hour', di.starts_at) as time_window_start,
         di.itinerary_id, it.pay_setting::text, it.vibe_tags, it.why_note,
         it.cover_image_url, it.title, pl.neighborhood,
         di.is_seed,
         st_distance(cc.centroid, me.pt) as distance_m
  from date_instances di
  join profiles cr on cr.id = di.creator_id
  join itineraries it on it.id = di.itinerary_id
  join cities cc on cc.id = di.city_id
  left join places pl on pl.id = di.venue_id
  cross join me
  where di.status = 'seeking'
    and di.starts_at > now()
    and di.moderation_status = 'approved'
    and cr.account_state = 'active' and cr.standing not in ('suspended','locked_ban')
    and di.creator_id <> p_viewer
    and not exists (select 1 from swipes s where s.swiper_id = p_viewer and s.date_instance_id = di.id)
    -- mutual gender compatibility
    and cr.gender = any (me.gender_preferences)
    and me.gender = any (cr.gender_preferences)
    -- mutual age compatibility
    and me.age <@ cr.age_pref and cr.age <@ me.age_pref
    -- distance within the tighter of the two preferences
    and st_dwithin(cc.centroid, me.pt, least(me.distance_pref_km, cr.distance_pref_km) * 1000)
    -- keyset pagination
    and (p_after_starts is null or (di.starts_at, di.id) > (p_after_starts, p_after_id))
  order by di.starts_at asc, di.id asc
  limit greatest(1, least(coalesce(p_limit,20), 50));
$fn$;
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from public;
grant execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) to authenticated;
```

> **Note for the implementer:** `browse_feed_for_viewer` takes `p_viewer` to honor the Contract C4 signature, but the body uses it only after the Edge/RLS layer guarantees it equals the caller; since 5a calls it from the authenticated client, pass `p_viewer = auth.uid()` (the default). A follow-up hardening (5b/S12) can assert `p_viewer = auth.uid()`; for 5a the function reads only blind columns so passing another id leaks nothing beyond the already-blind feed.

- [ ] **Step 5: Apply + run both tests to verify they pass**

Run: apply migration, then both psql test files.
Expected: PASS — `s5_browse_feed_blind OK`, `s5_browse_feed_compat OK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260527120300_s5_browse_feed.sql supabase/tests/s5_browse_feed_blind.sql supabase/tests/s5_browse_feed_compat.sql
git commit -m "feat(s5): browse_feed_for_viewer RPC (blind + mutual compat pre-filter)"
```

---

## Task 4: Regenerate DB types

**Files:**
- Modify: `packages/types/src/database.ts` (generated)

- [ ] **Step 1: Regenerate**

Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` updated with `record_swipe`, `post_night`, `browse_feed_for_viewer`, and the new `date_instances` columns; no errors.

- [ ] **Step 2: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: PASS (exit 0).

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "chore(types): regenerate database types for s5 feed RPCs"
```

---

## Task 5: `feedColdStartTier` pure function

**Files:**
- Create: `packages/business/src/feedColdStart.ts`, `packages/business/src/__tests__/feedColdStart.test.ts`
- Modify: `packages/business/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/business/src/__tests__/feedColdStart.test.ts
import { describe, it, expect } from 'vitest';
import { feedColdStartTier } from '../feedColdStart';

describe('feedColdStartTier', () => {
  it('empty when no compatible nights', () => {
    expect(feedColdStartTier({ compatibleOpen: 0, totalOpen: 0 })).toBe('empty');
  });
  it('thin when few compatible nights exist', () => {
    expect(feedColdStartTier({ compatibleOpen: 2, totalOpen: 9 })).toBe('thin');
  });
  it('live when enough compatible nights', () => {
    expect(feedColdStartTier({ compatibleOpen: 8, totalOpen: 20 })).toBe('live');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @after5/business test`
Expected: FAIL — cannot find module `../feedColdStart`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/business/src/feedColdStart.ts
export type FeedTier = 'empty' | 'thin' | 'live';
export interface FeedCounts { compatibleOpen: number; totalOpen: number; }

// 0 compatible → empty (show "lining up Kelowna"); <5 → thin (show what we have +
// seed/concierge nudge); otherwise live.
export function feedColdStartTier({ compatibleOpen }: FeedCounts): FeedTier {
  if (compatibleOpen <= 0) return 'empty';
  if (compatibleOpen < 5) return 'thin';
  return 'live';
}
```

- [ ] **Step 4: Re-export + run to verify it passes**

Add to `packages/business/src/index.ts`:
```ts
export { feedColdStartTier, type FeedTier, type FeedCounts } from './feedColdStart';
```
Run: `pnpm --filter @after5/business test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/feedColdStart.ts packages/business/src/__tests__/feedColdStart.test.ts packages/business/src/index.ts
git commit -m "feat(business): feedColdStartTier pure function"
```

---

## Task 6: api-client helpers + validator

**Files:**
- Create: `packages/api-client/src/feed.ts`, `packages/validators/src/feed.ts`
- Modify: `packages/api-client/src/index.ts`, `packages/validators/src/index.ts`, `apps/web/lib/after5/client.ts`

- [ ] **Step 1: Write the validator**

```ts
// packages/validators/src/feed.ts
import { z } from 'zod';
export const PostNightInput = z.object({
  itinerary_id: z.string().uuid(),
  starts_at: z.string().datetime(),            // ISO; RPC enforces future
  venue_id: z.string().uuid().nullable().optional(),
  duration_min: z.number().int().min(30).max(600).default(150),
});
export type PostNightInput = z.infer<typeof PostNightInput>;
```
Add to `packages/validators/src/index.ts`: `export * from './feed';`

- [ ] **Step 2: Write the helpers**

```ts
// packages/api-client/src/feed.ts
import type { After5Client } from './index';

export interface FeedNight {
  date_instance_id: string; city_id: string; time_window_start: string;
  itinerary_id: string; pay_setting: string | null; vibe_tags: string[] | null;
  why_note: string | null; cover_image_url: string | null; title: string | null;
  venue_neighborhood: string | null; is_seed: boolean; distance_m: number | null;
}

export async function postNight(client: After5Client, input: {
  itinerary_id: string; starts_at: string; venue_id?: string | null; duration_min?: number;
}): Promise<string> {
  const { data, error } = await client.rpc('post_night', {
    p_itinerary: input.itinerary_id, p_starts_at: input.starts_at,
    p_venue: input.venue_id ?? null, p_duration_min: input.duration_min ?? 150,
  });
  if (error) throw error;
  return data as string;
}

export async function browseFeed(client: After5Client, opts?: {
  afterStarts?: string | null; afterId?: string | null; limit?: number;
}): Promise<FeedNight[]> {
  const { data, error } = await client.rpc('browse_feed_for_viewer', {
    p_after_starts: opts?.afterStarts ?? null, p_after_id: opts?.afterId ?? null,
    p_limit: opts?.limit ?? 20,
  });
  if (error) throw error;
  return (data ?? []) as FeedNight[];
}

export async function recordSwipe(client: After5Client, instanceId: string, direction: 'left' | 'right'): Promise<void> {
  const { error } = await client.rpc('record_swipe', { p_instance: instanceId, p_direction: direction });
  if (error) throw error;
}
```
Add to `packages/api-client/src/index.ts`: `export { postNight, browseFeed, recordSwipe, type FeedNight } from './feed';`

- [ ] **Step 3: Re-export from the web client shim**

Add to `apps/web/lib/after5/client.ts` (the existing re-export block):
```ts
export { postNight, browseFeed, recordSwipe, type FeedNight } from '@after5/api-client';
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If the generated `Database` rpc types reject the names, confirm Task 4 regenerated; the helpers cast results to the local interfaces, which matches the existing `profile.ts` pattern.)

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/feed.ts packages/api-client/src/index.ts packages/validators/src/feed.ts packages/validators/src/index.ts apps/web/lib/after5/client.ts
git commit -m "feat(api-client): postNight/browseFeed/recordSwipe helpers + PostNightInput"
```

---

## Task 7: `/nights/new` — post a night

**Files:**
- Create: `apps/web/app/nights/new/page.tsx`, `apps/web/app/nights/new/PostNightForm.tsx`

- [ ] **Step 1: Write the server gate page**

```tsx
// apps/web/app/nights/new/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PostNightForm } from './PostNightForm';

export const dynamic = 'force-dynamic';

export default async function NewNightPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/nights/new');

  const { data: p } = await supabase
    .from('profiles').select('dating_enabled, verification').eq('id', user.id).maybeSingle();
  if (!p?.dating_enabled || p.verification !== 'verified') redirect('/onboarding');

  // The user's own + public itineraries to choose from (the existing plan library).
  const { data: plans } = await supabase
    .from('itineraries')
    .select('id, title, cover_image_url, vibe_tags')
    .or(`user_id.eq.${user.id},is_public.eq.true`)
    .order('generated_at', { ascending: false })
    .limit(30);

  return <PostNightForm plans={plans ?? []} />;
}
```

- [ ] **Step 2: Write the client form (all six states)**

```tsx
// apps/web/app/nights/new/PostNightForm.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserAfter5Client, postNight } from '@/lib/after5/client';
import { cn } from '@/lib/cn';

interface Plan { id: string; title: string | null; cover_image_url: string | null; vibe_tags: string[] | null; }

export function PostNightForm({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const [itineraryId, setItineraryId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const canPost = itineraryId && startsAt && new Date(startsAt) > new Date() && phase !== 'saving';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setPhase('saving'); setErrorMsg('');
    try {
      await postNight(browserAfter5Client(), { itinerary_id: itineraryId, starts_at: new Date(startsAt).toISOString() });
      router.push('/home');
    } catch (err) {
      console.error('[PostNightForm] post failed', err);
      setErrorMsg(err instanceof Error ? err.message : 'Could not post your night. Please try again.');
      setPhase('error');
    }
  }

  if (plans.length === 0) {
    return <main className="mx-auto max-w-xl px-6 py-16 text-center text-secondary">
      You don&apos;t have any plans yet. <a className="underline" href="/plan">Build one first</a>, then post it as a night.
    </main>;
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold text-text">Post a night</h1>
      <p className="mt-2 text-[15px] text-secondary">Pick a plan and a time. People nearby can say they&apos;re in — you choose who.</p>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block text-sm font-medium text-text">Plan
          <select value={itineraryId} onChange={(e) => setItineraryId(e.target.value)}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px]">
            <option value="">Choose a plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.title ?? 'Untitled plan'}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-text">When
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px]" />
        </label>
        {phase === 'error' && <div role="alert" className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>}
        <button type="submit" disabled={!canPost}
          className={cn('inline-flex w-full items-center justify-center rounded-pill px-7 py-3.5 text-[15px] font-medium transition-all',
            !canPost ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
          {phase === 'saving' ? 'Posting…' : phase === 'error' ? 'Try again' : 'Post this night'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Verify it compiles + renders**

Run: `pnpm --filter @after5/web build` (or hit `http://localhost:3000/nights/new` while `pnpm dev` runs — unauthenticated → redirects to `/login`, which proves the route compiles).
Expected: build OK; route returns 200/redirect, no 500.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/nights/new/page.tsx apps/web/app/nights/new/PostNightForm.tsx
git commit -m "feat(web): /nights/new — post a night from the plan library"
```

---

## Task 8: `/feed` — blind swipe deck

**Files:**
- Create: `apps/web/app/feed/page.tsx`, `apps/web/app/feed/SwipeDeck.tsx`, `apps/web/app/feed/NightCard.tsx`
- Test: `apps/web/app/feed/__tests__/SwipeDeck.test.tsx`

- [ ] **Step 1: Write the server fetch page**

```tsx
// apps/web/app/feed/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { browseFeed } from '@after5/api-client';
import { SwipeDeck } from './SwipeDeck';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/feed');
  const { data: p } = await supabase
    .from('profiles').select('dating_enabled, verification').eq('id', user.id).maybeSingle();
  if (!p?.dating_enabled || p.verification !== 'verified') redirect('/onboarding');

  const nights = await browseFeed(supabase, { limit: 20 }).catch(() => []);
  return <SwipeDeck initial={nights} />;
}
```

- [ ] **Step 2: Write the NightCard (presentational)**

```tsx
// apps/web/app/feed/NightCard.tsx
import Image from 'next/image';
import type { FeedNight } from '@after5/api-client';

export function NightCard({ night }: { night: FeedNight }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-white shadow">
      {night.cover_image_url
        ? <Image src={night.cover_image_url} alt="" width={500} height={300} className="h-56 w-full object-cover" />
        : <div className="h-56 w-full bg-gradient-to-br from-amber-100 to-rose-100" />}
      <div className="p-5">
        <h2 className="font-display text-xl font-bold text-text">{night.title ?? 'A Kelowna night'}</h2>
        {night.why_note && <p className="mt-2 text-[14px] leading-relaxed text-secondary">{night.why_note}</p>}
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
          {night.venue_neighborhood && <span>{night.venue_neighborhood}</span>}
          <span>{new Date(night.time_window_start).toLocaleString([], { weekday: 'short', hour: 'numeric' })}</span>
          {night.is_seed && <span className="rounded bg-amber-100 px-1.5 text-amber-900">curated</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the failing SwipeDeck test**

```tsx
// apps/web/app/feed/__tests__/SwipeDeck.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const recordSwipe = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}), recordSwipe: (...a: unknown[]) => recordSwipe(...a) }));
import { SwipeDeck } from '../SwipeDeck';
const night = (id: string) => ({ date_instance_id: id, city_id: 'c', time_window_start: new Date(Date.now()+86400000).toISOString(), itinerary_id: 'i', pay_setting: null, vibe_tags: [], why_note: 'w', cover_image_url: null, title: 'T', venue_neighborhood: null, is_seed: false, distance_m: 1000 });

beforeEach(() => recordSwipe.mockClear());

describe('SwipeDeck', () => {
  it('empty: shows the cold-start message when no nights', () => {
    render(<SwipeDeck initial={[]} />);
    expect(screen.getByText(/lining up/i)).toBeInTheDocument();
  });
  it('swipe right records and advances to the next card', async () => {
    render(<SwipeDeck initial={[night('a'), night('b')]} />);
    await userEvent.click(screen.getByRole('button', { name: /interested/i }));
    await waitFor(() => expect(recordSwipe).toHaveBeenCalledWith(expect.anything(), 'a', 'right'));
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @after5/web test -- SwipeDeck`
Expected: FAIL — cannot find module `../SwipeDeck`.

- [ ] **Step 5: Write the SwipeDeck (all six states)**

```tsx
// apps/web/app/feed/SwipeDeck.tsx
'use client';
import { useState } from 'react';
import { browserAfter5Client, recordSwipe, type FeedNight } from '@/lib/after5/client';
import { NightCard } from './NightCard';
import { cn } from '@/lib/cn';

export function SwipeDeck({ initial }: { initial: FeedNight[] }) {
  const [deck, setDeck] = useState(initial);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = deck[i];

  async function swipe(direction: 'left' | 'right') {
    if (!current || busy) return;
    setBusy(true); setError('');
    try {
      await recordSwipe(browserAfter5Client(), current.date_instance_id, direction);
      setI((n) => n + 1);
    } catch (e) {
      setError('That didn’t go through — try again.');
    } finally { setBusy(false); }
  }

  if (deck.length === 0 || i >= deck.length) {
    return <main className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="font-display text-xl font-semibold text-text">We&apos;re lining up Kelowna nights.</p>
      <p className="mt-2 text-secondary">Check back soon, or <a className="underline" href="/nights/new">post your own night</a>.</p>
    </main>;
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <NightCard night={current} />
      {error && <p role="alert" className="mt-3 text-center text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-center gap-4">
        <button type="button" onClick={() => swipe('left')} disabled={busy}
          className={cn('rounded-pill border border-border px-8 py-3 text-[15px] font-medium', busy && 'opacity-50')}>Pass</button>
        <button type="button" onClick={() => swipe('right')} disabled={busy} aria-label="I'm interested"
          className={cn('rounded-pill bg-accent px-8 py-3 text-[15px] font-medium text-white', busy && 'opacity-50')}>I&apos;m interested</button>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @after5/web test -- SwipeDeck`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/feed/page.tsx apps/web/app/feed/SwipeDeck.tsx apps/web/app/feed/NightCard.tsx apps/web/app/feed/__tests__/SwipeDeck.test.tsx
git commit -m "feat(web): /feed blind swipe deck with cold-start + six states"
```

---

## Task 9: Home entry point

**Files:**
- Modify: `apps/web/app/home/FirstSessionHome.tsx` (the dating home; add the loop entry for dating-enabled users)

- [ ] **Step 1: Add the entry (only when dating is on)**

In `FirstSessionHome.tsx`, where the primary actions render, add (guarded by the existing `dating_enabled`/verified home state):
```tsx
<div className="mt-6 flex flex-wrap gap-3">
  <a href="/feed" className="rounded-pill bg-text px-6 py-3 text-[15px] font-medium text-background">Browse tonight&apos;s nights</a>
  <a href="/nights/new" className="rounded-pill border border-border px-6 py-3 text-[15px] font-medium text-text">Post a night</a>
</div>
```

- [ ] **Step 2: Verify the home test still passes + add an assertion**

Run: `pnpm --filter @after5/web test -- FirstSessionHome`
Expected: PASS. If the existing test asserts exact actions, extend it to allow/expect the new links for the verified+dating-enabled state. Do not change behavior for non-dating states (legacy planner home untouched).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/home/FirstSessionHome.tsx apps/web/app/home/__tests__/FirstSessionHome.state.test.tsx
git commit -m "feat(web): home entry into the dating loop (/feed + /nights/new) for dating-enabled users"
```

---

## Task 10: Integration — full suite + manual browser E2E

**Files:** none (verification only)

- [ ] **Step 1: Run the DB tests**

Run: `pnpm db:test`
Expected: every `supabase/tests/s5_*.sql` prints its `... OK` notice; exit 0.

- [ ] **Step 2: Run the full gate suite**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 3: Manual browser E2E (two accounts, local)**

1. Account A (verified, dating-enabled): `/nights/new` → pick a plan + a future time → Post → lands on `/home`.
2. Account B (compatible — opposite gender prefs that mutually match, within distance, in Kelowna, verified+dating-enabled): `/feed` → sees A's night **with no name/photo of A** → click "I'm interested" → card advances, swipe persists.
3. Re-load B's `/feed` → A's night is gone (already swiped). Confirm B never saw A's identity anywhere.
4. Empty case: a viewer with no compatible nights sees the "lining up Kelowna nights" message.

Expected: all steps pass; the blind contract holds.

- [ ] **Step 4: Final commit (if any test fixtures/tweaks were needed)**

```bash
git add -A
git commit -m "test(s5): phase 5a integration green (db + suite + manual E2E)"
```

---

## Self-Review

**Spec coverage:** §4.1 moderation_status + is_seed → Task 0 ✅. §4.2 post-a-night → Task 2 (+ Task 7 UI) ✅. §4.3 browse_feed_for_viewer (projection, sources, mutual compat, filters, exclusions, pagination) → Task 3 ✅. §4.4 record_swipe idempotent → Task 1 ✅. §4.5 cold-start pure fn → Task 5; concierge seed → noted (optional, Task 10 manual / out-of-band script, not required for green) ✅. §4.6 `/feed` + `/nights/new` + home entry, six states → Tasks 7/8/9 ✅. §5 blind contract leak test → Task 3 Step 1 ✅. §6 auth.uid(), no Edge Functions → all RPCs ✅. §7 testing (psql leak/compat/idempotency/guards, vitest, manual E2E) → Tasks 1/2/3/5/8/10 ✅.

**Gaps fixed inline:** (1) Concierge seed *script* is not a coded task — it's optional per spec §4.5 and not required for the loop to be green; if desired, it's a one-off `supabase/seed` insert using `post_night` under a host account, added without blocking. (2) `pay_setting` is projected raw from `itineraries` (labels are S11) — NightCard does not render it yet to avoid shipping an unlabeled money string; surfaced in the data, displayed in S11.

**Placeholder scan:** every code step has complete, runnable SQL/TS/TSX + exact commands + expected output. No TBD/"similar to"/"add error handling" stubs.

**Type/name consistency:** RPC names (`record_swipe`, `post_night`, `browse_feed_for_viewer`) identical across migrations, tests, api-client, and `database.ts` regen (Task 4 precedes the helpers in Task 6). `FeedNight` shape matches the `browse_feed_for_viewer` RETURNS TABLE columns exactly. `swipe_direction` values `'left'|'right'` consistent (DB enum ↔ helper union). `PostNightInput` fields map to `post_night` params (`itinerary_id→p_itinerary`, `starts_at→p_starts_at`, etc.).

**Dependency order:** Task 0 (columns) → 1/2/3 (RPCs, each depends on columns) → 4 (types, after all RPCs) → 5/6 (TS, after types) → 7/8/9 (web, after helpers) → 10 (integration). Migrations sort `20260527*` after S1–S3. No `create or replace browse_feed` view (C11.3) — 5a ships only the RPC.
