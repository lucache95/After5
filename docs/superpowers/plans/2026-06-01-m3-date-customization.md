# M3 — Date Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host customize any aspect of a generated date — reorder/retime/retitle/rewrite/add/remove stops and pick the cover photo — and guarantee that editing a *posted* night never changes what other swipers saw (fork-on-post).

**Architecture:** A single owner-scoped validating RPC `update_itinerary_stops` is the only write path for stop/title/why/cover edits (owners already hold UPDATE RLS on `itineraries`, but the RPC validates the jsonb shape + clamps in one place). `post_night` is extended to **fork** (deep-copy) the itinerary at publish time, so each posted night owns a private copy — editing it can't bleed to the canonical generated plan or to other nights that referenced the same itinerary. The edit UI is a new `ItineraryEditor` built from a new `EditableStopCard` (the read-only `StopCard`/`ItineraryView`, shared with M2, are left untouched), reusing the framer-motion `Reorder` pattern already proven in `PhotoManager` (M6) and `InterestedList`.

**Tech Stack:** Supabase Postgres (SECURITY DEFINER PL/pgSQL RPC, jsonb validation, RLS), Next.js 15 App Router (owner-only route), React 19, framer-motion `Reorder`, Tailwind Barbiecore (`shell-*`, Caprasimo/Fredoka, lowercase, `max-w-[480px]`), Supabase JS.

**Scope for this plan (v1):** stop edit/reorder/add/remove + per-stop time/title/note/what-to-do, cover-photo picker (from existing stop photos — no new upload bucket), the validating RPC, and fork-on-post. **DEFERRED (explicit, not dropped):** custom venue via a Google Places proxy (`/api/places/search`) as an inline stop + admin promotion queue — it cannot function until `GOOGLE_PLACES_API_KEY` is provisioned (task #67), so it ships coupled with #67 as M3.5. Tracked in the Self-Review.

**Sequencing:** M2 (shared `ItineraryView`/`StopCard`) is already shipped. Do NOT push until CI green; commits stack on `main` and push at the end (same cadence as M2).

---

## Conventions for every task

- Web tests: `pnpm --filter @after5/web test <path>` (vitest/jsdom). Typecheck: `pnpm --filter @after5/web typecheck`. Lint (CI parity, must be 0 errors): `cd apps/web && pnpm exec next lint`.
- SQL tests: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f <file>` (expects `... OK` NOTICE, exit 0). New migrations apply forward with `supabase migration up --local --include-all` (do NOT `db reset` — shared local DB).
- After any change to a vitest-mocked module's exports, run the FULL web suite before committing (missing mock export silently breaks unrelated specs — recurring CI failure).
- NEVER add an `eslint-disable` for `@typescript-eslint/no-explicit-any` — that rule is not in the flat config and referencing it is a hard lint error. If you need a loose type, write a small named type alias instead.
- Any new SECURITY DEFINER function MUST `revoke execute ... from anon` (Supabase default privileges auto-grant anon EXECUTE; `revoke from public` alone is insufficient — recurring gotcha). Run `get_advisors(security)` mindset locally; CI + the prod-apply step will confirm.
- Migration timestamps: use the `20260602140000`+ block (M4 used 1200xx, M6 1300xx; leave headroom).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. One commit per task. Do NOT push until the final task.
- Lowercase Barbiecore copy throughout.

---

## File Structure

**New files:**
- `supabase/migrations/20260602140000_m3_update_itinerary_stops.sql` — the validating owner-scoped edit RPC.
- `supabase/migrations/20260602140100_m3_post_night_fork.sql` — fork-on-post: `post_night` deep-copies the itinerary.
- `supabase/tests/m3_update_itinerary_stops.sql` — RPC owner-scope + validation + anon-revoke tests.
- `supabase/tests/m3_post_night_fork.sql` — proves a posted night gets a private itinerary copy; editing it doesn't touch the canonical.
- `apps/web/lib/itinerary/edit.ts` — pure helpers: `reorderStops`, `patchStop`, `removeStop`, `addBlankStop`, `validateStopsForSave` (mirror the RPC's checks client-side for instant feedback).
- `apps/web/lib/itinerary/__tests__/edit.test.ts`.
- `apps/web/app/plans/[id]/edit/page.tsx` — owner-only RSC shell (loads the itinerary, 404/redirect if not owner) → `<ItineraryEditor>`.
- `apps/web/app/plans/[id]/edit/ItineraryEditor.tsx` — `'use client'` edit surface (reorder + per-stop edit + add/remove + cover picker + save).
- `apps/web/app/plans/[id]/edit/EditableStopCard.tsx` — editable stop row (time/title/what-to-do/remove), drag handle.
- `apps/web/app/plans/[id]/edit/CoverPicker.tsx` — choose cover from stop photos.
- `apps/web/app/plans/[id]/edit/__tests__/ItineraryEditor.test.tsx`.
- `apps/web/e2e/m3-edit.spec.ts` — Chromium: edit a seeded itinerary, reorder + retitle + pick cover, save, reload shows persisted edits.

**Modified files:**
- `packages/api-client/src/feed.ts` — add `updateItineraryStops(client, input)` wrapper + `EditableStop` type re-export.
- `packages/api-client/src/__tests__/feed.test.ts` — wrapper unit test.
- `apps/web/playwright.config.ts:21` — extend `testMatch` to include `m3-`.

**Reused unchanged:** `StopCard`, `ItineraryView` (read-only), `coverImageFor` (`apps/web/lib/place-image.ts`), the `Stop` type (`apps/web/lib/itinerary-types.ts`), the `Reorder` pattern from `PhotoManager`.

---

### Task 1: `update_itinerary_stops` validating RPC

**Files:**
- Create: `supabase/migrations/20260602140000_m3_update_itinerary_stops.sql`
- Test: `supabase/tests/m3_update_itinerary_stops.sql`

Owner-scoped (`itineraries.user_id = auth.uid()`), SECURITY DEFINER. Validates `p_stops` is a non-empty jsonb array (≤12) where every element has `place_name` (non-empty text), `start_time` (text), `duration_min` (int ≥0), `estimated_cost_pp` (number ≥0). Updates `stops`, and `title`/`why_note`/`cover_image_url` when provided (NULL = leave unchanged). Returns the updated itinerary id. Raises `42501 not_owner` if the caller doesn't own it, `P0001` on shape violations.

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/m3_update_itinerary_stops.sql
-- M3: owner-scoped validated itinerary edit RPC.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE owner_id uuid; other uuid; itin uuid; n int; got jsonb;
BEGIN
  owner_id := mk_user('m3_owner'); other := mk_user('m3_other');
  itin := mk_itinerary(owner_id);

  -- owner edits: valid stops + title persist
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_itinerary_stops(
    itin,
    '[{"place_id":"p1","place_name":"clay studio","start_time":"18:00","duration_min":90,"estimated_cost_pp":35}]'::jsonb,
    'pottery + ramen', 'low-key, hands dirty', 'https://img/cover.jpg');
  RESET ROLE;
  SELECT title, stops INTO got FROM (SELECT to_jsonb(i) AS j FROM itineraries i WHERE id=itin) z, lateral (select z.j->>'title' as title, z.j->'stops' as stops) y;
  SELECT count(*) INTO n FROM itineraries WHERE id=itin AND title='pottery + ramen'
    AND cover_image_url='https://img/cover.jpg' AND jsonb_array_length(stops)=1;
  IF n<>1 THEN RAISE EXCEPTION 'M3.1a: owner edit did not persist (n=%)', n; END IF;
  RAISE NOTICE 'M3.1a: owner edit persists OK';

  -- non-owner is blocked
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_itinerary_stops(itin, '[{"place_id":"x","place_name":"sneaky","start_time":"1","duration_min":1,"estimated_cost_pp":1}]'::jsonb, null, null, null);
    RESET ROLE; RAISE EXCEPTION 'M3.1b: non-owner edit should have raised';
  EXCEPTION WHEN sqlstate '42501' THEN RESET ROLE; RAISE NOTICE 'M3.1b: non-owner blocked OK';
  END;

  -- empty stops array is rejected
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_itinerary_stops(itin, '[]'::jsonb, null, null, null);
    RESET ROLE; RAISE EXCEPTION 'M3.1c: empty stops should have raised';
  EXCEPTION WHEN sqlstate 'P0001' THEN RESET ROLE; RAISE NOTICE 'M3.1c: empty stops rejected OK';
  END;

  -- a stop missing place_name is rejected
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_itinerary_stops(itin, '[{"place_id":"x","start_time":"1","duration_min":1,"estimated_cost_pp":1}]'::jsonb, null, null, null);
    RESET ROLE; RAISE EXCEPTION 'M3.1d: missing place_name should have raised';
  EXCEPTION WHEN sqlstate 'P0001' THEN RESET ROLE; RAISE NOTICE 'M3.1d: invalid stop rejected OK';
  END;

  -- anon must NOT have execute
  IF has_function_privilege('anon','update_itinerary_stops(uuid, jsonb, text, text, text)','execute') THEN
    RAISE EXCEPTION 'M3.1e: anon should NOT execute update_itinerary_stops';
  END IF;
  RAISE NOTICE 'M3.1e: anon execute revoked OK';

  RAISE NOTICE 'M3.1: update_itinerary_stops OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it (expect FAIL — function missing)**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/m3_update_itinerary_stops.sql`
Expected: ERROR (function `update_itinerary_stops` does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260602140000_m3_update_itinerary_stops.sql
-- M3: the single validated write path for host itinerary edits (stops + title/why/cover).
-- Owners already hold UPDATE RLS (itineraries_owner_all); this RPC adds shape validation
-- + a clamp in one place and is the only thing the edit UI calls.
create or replace function update_itinerary_stops(
  p_itinerary uuid,
  p_stops jsonb,
  p_title text default null,
  p_why_note text default null,
  p_cover_image_url text default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_owns boolean; s jsonb;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;

  select (user_id = v_actor) into v_owns from itineraries where id = p_itinerary;
  if not coalesce(v_owns, false) then
    raise exception 'not your itinerary' using errcode='42501';
  end if;

  if jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) = 0 then
    raise exception 'stops must be a non-empty array' using errcode='P0001';
  end if;
  if jsonb_array_length(p_stops) > 12 then
    raise exception 'too many stops (max 12)' using errcode='P0001';
  end if;
  for s in select * from jsonb_array_elements(p_stops) loop
    if coalesce(s->>'place_name','') = '' then
      raise exception 'each stop needs a place_name' using errcode='P0001';
    end if;
    if (s->>'start_time') is null then
      raise exception 'each stop needs a start_time' using errcode='P0001';
    end if;
    if coalesce((s->>'duration_min')::int, -1) < 0 then
      raise exception 'each stop needs a non-negative duration_min' using errcode='P0001';
    end if;
    if coalesce((s->>'estimated_cost_pp')::numeric, -1) < 0 then
      raise exception 'each stop needs a non-negative estimated_cost_pp' using errcode='P0001';
    end if;
  end loop;

  update itineraries
     set stops = p_stops,
         title = coalesce(p_title, title),
         why_note = coalesce(p_why_note, why_note),
         cover_image_url = coalesce(p_cover_image_url, cover_image_url),
         total_cost_pp = (select coalesce(sum((e->>'estimated_cost_pp')::numeric),0) from jsonb_array_elements(p_stops) e),
         total_duration_min = (select coalesce(sum((e->>'duration_min')::int),0) from jsonb_array_elements(p_stops) e)
   where id = p_itinerary;
  return p_itinerary;
end $fn$;

revoke execute on function update_itinerary_stops(uuid, jsonb, text, text, text) from public;
revoke execute on function update_itinerary_stops(uuid, jsonb, text, text, text) from anon;
grant execute on function update_itinerary_stops(uuid, jsonb, text, text, text) to authenticated;
```

- [ ] **Step 4: Apply + run the test (expect PASS)**

Run:
```
supabase migration up --local --include-all
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/m3_update_itinerary_stops.sql
```
Expected: NOTICEs `M3.1a..e OK`, `M3.1: update_itinerary_stops OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260602140000_m3_update_itinerary_stops.sql supabase/tests/m3_update_itinerary_stops.sql
git commit -m "feat(m3): owner-scoped validated update_itinerary_stops RPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Fork-on-post (`post_night` deep-copies the itinerary)

**Files:**
- Create: `supabase/migrations/20260602140100_m3_post_night_fork.sql`
- Test: `supabase/tests/m3_post_night_fork.sql`

When a host posts a night, copy the chosen itinerary into a new private itinerary row (same content, `user_id = host`, `is_public = false`) and point the `date_instance` at the copy. This makes per-night edits (Task 1) safe: editing a posted night's itinerary can never mutate the canonical generated plan or bleed to another night that referenced the same itinerary. Swipes/offers/locks key off `date_instance_id`, so the fork is invisible to them. Preserve every existing guard (auth, future, verified+dating, curated-venue, ambient validation) verbatim — only the insert changes to fork-then-reference.

- [ ] **Step 1: Write the failing SQL test**

```sql
-- supabase/tests/m3_post_night_fork.sql
-- M3: post_night forks the itinerary so the posted night owns a private copy.
\i supabase/tests/_fixtures.sql
insert into feature_config(key,value) values ('match_v2_enabled','true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;
DO $$
DECLARE host uuid; canon uuid; cid uuid; inst uuid; forked uuid; canon_title text;
BEGIN
  host := mk_user('m3_host');
  insert into profiles_private(user_id, birthdate) values (host,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, verification='verified',
    primary_city_id=(select id from cities where slug='kelowna') where id=host;
  canon := mk_itinerary(host);
  update itineraries set title='canonical night',
    stops='[{"place_id":"p1","place_name":"a","start_time":"18:00","duration_min":60,"estimated_cost_pp":20}]'::jsonb,
    is_public=true where id=canon;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', host::text, 'role','authenticated')::text, true);
  inst := post_night(canon, now() + interval '2 days', null, 150, null);

  SELECT itinerary_id INTO forked FROM date_instances WHERE id=inst;
  IF forked = canon THEN RAISE EXCEPTION 'M3.2a: post_night did NOT fork (instance points at canonical)'; END IF;
  RAISE NOTICE 'M3.2a: posted night points at a forked itinerary OK';

  -- the fork is a faithful copy owned by the host
  PERFORM 1 FROM itineraries WHERE id=forked AND user_id=host AND title='canonical night'
    AND jsonb_array_length(stops)=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'M3.2b: fork is not a faithful host-owned copy'; END IF;
  RAISE NOTICE 'M3.2b: fork is a faithful host-owned copy OK';

  -- editing the fork does NOT change the canonical
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', host::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_itinerary_stops(forked,
    '[{"place_id":"p1","place_name":"edited","start_time":"19:00","duration_min":90,"estimated_cost_pp":40}]'::jsonb,
    'edited night', null, null);
  RESET ROLE;
  SELECT title INTO canon_title FROM itineraries WHERE id=canon;
  IF canon_title <> 'canonical night' THEN RAISE EXCEPTION 'M3.2c: editing the fork bled into the canonical (%)', canon_title; END IF;
  RAISE NOTICE 'M3.2c: editing the fork leaves canonical untouched OK';

  RAISE NOTICE 'M3.2: post_night fork-on-post OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it (expect FAIL — no fork yet)**

Run: `psql ... -f supabase/tests/m3_post_night_fork.sql`
Expected: FAIL at M3.2a (instance points at canonical).

- [ ] **Step 3: Write the migration (re-create post_night with the fork)**

```sql
-- supabase/migrations/20260602140100_m3_post_night_fork.sql
-- M3 fork-on-post: copy the chosen itinerary into a private host-owned itinerary and
-- point the date_instance at the copy, so per-night edits (update_itinerary_stops)
-- never mutate the canonical generated plan or bleed to other nights. All existing
-- guards preserved verbatim from 20260602120300/120700 (5-arg signature, anon revoked
-- separately by 20260602120600 which still applies to this same signature).
create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150,
  p_ambient_sound_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_city uuid; v_ok boolean; v_id uuid; v_venue_ok boolean; v_fork uuid;
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

  if p_venue is not null then
    select (approval_status = 'live' and is_active) into v_venue_ok from places where id = p_venue;
    if not coalesce(v_venue_ok,false) then
      raise exception 'venue must be a reviewed (live) place to host a dating meetup' using errcode='P0001';
    end if;
  end if;

  if p_ambient_sound_id is not null then
    perform 1 from ambient_sounds where id = p_ambient_sound_id and is_active = true;
    if not found then
      raise exception 'ambient sound not found or inactive' using errcode='P0001';
    end if;
  end if;

  -- FORK: deep-copy the itinerary into a private host-owned row. The night references
  -- the fork; the canonical generated plan is never touched by later edits.
  insert into itineraries (
    user_id, template_id, inputs, stops, title, hook, why_it_works,
    total_cost_pp, total_duration_min, is_public, city_id, pay_setting,
    why_note, vibe_tags, cover_image_url, slug, intent
  )
  select v_actor, template_id, inputs, stops, title, hook, why_it_works,
         total_cost_pp, total_duration_min, false, city_id, pay_setting,
         why_note, vibe_tags, cover_image_url, slug, intent
  from itineraries where id = p_itinerary
  returning id into v_fork;

  insert into date_instances
    (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status, ambient_sound_id)
  values
    (v_fork, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking', p_ambient_sound_id)
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function post_night(uuid, timestamptz, uuid, integer, uuid) from public;
revoke execute on function post_night(uuid, timestamptz, uuid, integer, uuid) from anon;
grant execute on function post_night(uuid, timestamptz, uuid, integer, uuid) to authenticated;
```

- [ ] **Step 4: Apply + run BOTH SQL tests (fork + the existing s5_post_night regression)**

Run:
```
supabase migration up --local --include-all
psql ... -f supabase/tests/m3_post_night_fork.sql
psql ... -f supabase/tests/s5_post_night.sql
```
Expected: `M3.2 ... OK` exit 0; `s5_post_night OK` exit 0 (the post_night contract still holds — it still returns a date_instance id, just pointing at the fork). If s5_post_night asserts the instance points at the *input* itinerary id, update that assertion to accept a fork (the night's itinerary is now a copy) and note the deviation.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260602140100_m3_post_night_fork.sql supabase/tests/m3_post_night_fork.sql
git commit -m "feat(m3): fork-on-post — post_night deep-copies the itinerary per night

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: api-client `updateItineraryStops` wrapper

**Files:**
- Modify: `packages/api-client/src/feed.ts`
- Test: `packages/api-client/src/__tests__/feed.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to packages/api-client/src/__tests__/feed.test.ts
import { updateItineraryStops } from '../feed';

it('updateItineraryStops calls the RPC with mapped params and returns the id', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: 'itin-1', error: null });
  const client = { rpc } as any;
  const id = await updateItineraryStops(client, {
    itinerary_id: 'itin-1',
    stops: [{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 90, estimated_cost_pp: 35 }],
    title: 'pottery + ramen',
  });
  expect(id).toBe('itin-1');
  expect(rpc).toHaveBeenCalledWith('update_itinerary_stops', expect.objectContaining({
    p_itinerary: 'itin-1', p_title: 'pottery + ramen',
  }));
});
```

- [ ] **Step 2: Run (expect FAIL — no export)**

Run: `pnpm --filter @after5/api-client test`
Expected: FAIL — `updateItineraryStops` is not exported.

- [ ] **Step 3: Implement the wrapper**

```typescript
// packages/api-client/src/feed.ts — add near postNight. Reuse the existing Stop-ish shape.
export interface EditableStop {
  place_id?: string; place_name: string; place_slug?: string; place_type?: string;
  start_time: string; duration_min: number; estimated_cost_pp: number;
  what_to_do?: string; drive_to_next_min?: number; photo_url?: string | null;
  address?: string | null; neighborhood?: string; lat?: number | null; lng?: number | null;
  local_insight?: string | null; reservation_url?: string | null; reservation_required?: boolean;
}

export async function updateItineraryStops(
  client: After5Client,
  input: { itinerary_id: string; stops: EditableStop[]; title?: string; why_note?: string; cover_image_url?: string },
): Promise<string> {
  const { data, error } = await client.rpc('update_itinerary_stops', {
    p_itinerary: input.itinerary_id,
    p_stops: input.stops,
    p_title: input.title ?? undefined,
    p_why_note: input.why_note ?? undefined,
    p_cover_image_url: input.cover_image_url ?? undefined,
  });
  if (error) throw error;
  return data as string;
}
```

Export it from `packages/api-client/src/index.ts` (follow how `postNight`/`getNightDetail` are re-exported).

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @after5/api-client test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/feed.ts packages/api-client/src/index.ts packages/api-client/src/__tests__/feed.test.ts
git commit -m "feat(m3): updateItineraryStops api-client wrapper + EditableStop type

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Pure edit helpers

**Files:**
- Create: `apps/web/lib/itinerary/edit.ts`
- Test: `apps/web/lib/itinerary/__tests__/edit.test.ts`

Pure functions the editor uses, so the UI stays thin and the logic is unit-tested.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/itinerary/__tests__/edit.test.ts
import { describe, it, expect } from 'vitest';
import { reorderStops, patchStop, removeStop, addBlankStop, validateStopsForSave } from '../edit';
import type { Stop } from '@/lib/itinerary-types';

const s = (id: string, over: Partial<Stop> = {}): Stop => ({
  place_id: id, place_name: id, start_time: '18:00', duration_min: 60, estimated_cost_pp: 20, ...over,
});

describe('itinerary edit helpers', () => {
  it('reorderStops moves an item', () => {
    const out = reorderStops([s('a'), s('b'), s('c')], 0, 2);
    expect(out.map((x) => x.place_id)).toEqual(['b', 'c', 'a']);
  });
  it('patchStop updates one stop immutably', () => {
    const stops = [s('a'), s('b')];
    const out = patchStop(stops, 1, { place_name: 'renamed' });
    expect(out[1].place_name).toBe('renamed');
    expect(stops[1].place_name).toBe('b'); // original untouched
  });
  it('removeStop drops by index', () => {
    expect(removeStop([s('a'), s('b')], 0).map((x) => x.place_id)).toEqual(['b']);
  });
  it('addBlankStop appends an editable blank with sane defaults', () => {
    const out = addBlankStop([s('a')]);
    expect(out.length).toBe(2);
    expect(out[1].place_name).toBe('');
    expect(out[1].duration_min).toBeGreaterThanOrEqual(0);
  });
  it('validateStopsForSave mirrors the RPC: empty array + blank name + >12 fail', () => {
    expect(validateStopsForSave([]).ok).toBe(false);
    expect(validateStopsForSave([s('a', { place_name: '' })]).ok).toBe(false);
    expect(validateStopsForSave(Array.from({ length: 13 }, (_, i) => s(String(i)))).ok).toBe(false);
    expect(validateStopsForSave([s('a')]).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `pnpm --filter @after5/web test lib/itinerary/__tests__/edit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/web/lib/itinerary/edit.ts
import type { Stop } from '@/lib/itinerary-types';

export function reorderStops(stops: Stop[], from: number, to: number): Stop[] {
  const next = stops.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
export function patchStop(stops: Stop[], index: number, patch: Partial<Stop>): Stop[] {
  return stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
}
export function removeStop(stops: Stop[], index: number): Stop[] {
  return stops.filter((_, i) => i !== index);
}
export function addBlankStop(stops: Stop[]): Stop[] {
  return [...stops, { place_id: '', place_name: '', start_time: '19:00', duration_min: 60, estimated_cost_pp: 0 }];
}
export function validateStopsForSave(stops: Stop[]): { ok: boolean; reason?: string } {
  if (stops.length === 0) return { ok: false, reason: 'add at least one stop' };
  if (stops.length > 12) return { ok: false, reason: 'max 12 stops' };
  for (const s of stops) {
    if (!s.place_name?.trim()) return { ok: false, reason: 'every stop needs a name' };
    if ((s.duration_min ?? -1) < 0) return { ok: false, reason: 'duration can’t be negative' };
    if ((s.estimated_cost_pp ?? -1) < 0) return { ok: false, reason: 'cost can’t be negative' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @after5/web test lib/itinerary/__tests__/edit.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/itinerary/edit.ts apps/web/lib/itinerary/__tests__/edit.test.ts
git commit -m "feat(m3): pure itinerary edit helpers (reorder/patch/remove/add/validate)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `EditableStopCard` + `CoverPicker`

**Files:**
- Create: `apps/web/app/plans/[id]/edit/EditableStopCard.tsx`
- Create: `apps/web/app/plans/[id]/edit/CoverPicker.tsx`
- Test: `apps/web/app/plans/[id]/edit/__tests__/ItineraryEditor.test.tsx` (covers these two + the editor in Task 6; write the EditableStopCard/CoverPicker cases here first)

`EditableStopCard`: a controlled editable row — text input for `place_name`, `start_time`, a textarea for `what_to_do`, number inputs for `duration_min`/`estimated_cost_pp`, a remove button, and a drag handle (visual; the Reorder wiring lives in the editor). All Barbiecore. `CoverPicker`: shows a grid of the itinerary's stop `photo_url`s; clicking one calls `onPick(url)`; the current cover is highlighted.

- [ ] **Step 1: Write the failing test (these two components)**

```typescript
// apps/web/app/plans/[id]/edit/__tests__/ItineraryEditor.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableStopCard } from '../EditableStopCard';
import { CoverPicker } from '../CoverPicker';

describe('EditableStopCard', () => {
  it('edits the name + fires onPatch, and remove fires onRemove', async () => {
    const onPatch = vi.fn(); const onRemove = vi.fn();
    render(<EditableStopCard stop={{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }} index={0} onPatch={onPatch} onRemove={onRemove} />);
    const name = screen.getByLabelText(/name/i);
    fireEvent.change(name, { target: { value: 'pottery' } });
    expect(onPatch).toHaveBeenCalledWith(0, expect.objectContaining({ place_name: 'pottery' }));
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

describe('CoverPicker', () => {
  it('renders stop photos and fires onPick', async () => {
    const onPick = vi.fn();
    render(<CoverPicker photos={['a.jpg', 'b.jpg']} current="a.jpg" onPick={onPick} />);
    const opts = screen.getAllByRole('button', { name: /use this cover/i });
    await userEvent.click(opts[1]);
    expect(onPick).toHaveBeenCalledWith('b.jpg');
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `pnpm --filter @after5/web test "app/plans/\[id\]/edit/__tests__/ItineraryEditor.test.tsx"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both components** (Barbiecore; lowercase; `shell-*`). `EditableStopCard` props: `{ stop: Stop; index: number; onPatch: (i: number, patch: Partial<Stop>) => void; onRemove: (i: number) => void }`. `CoverPicker` props: `{ photos: string[]; current?: string | null; onPick: (url: string) => void }`. Each cover option is a `<button aria-label="use this cover">` wrapping the thumbnail; highlight when `photo === current`. Inputs use `aria-label` (`name`, `start time`, `what to do`, `minutes`, `cost`) so tests + a11y are stable.

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @after5/web test "app/plans/\[id\]/edit/__tests__/ItineraryEditor.test.tsx"`
Expected: the EditableStopCard + CoverPicker cases PASS (the editor case is added in Task 6).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/plans/[id]/edit/EditableStopCard.tsx" "apps/web/app/plans/[id]/edit/CoverPicker.tsx" "apps/web/app/plans/[id]/edit/__tests__/ItineraryEditor.test.tsx"
git commit -m "feat(m3): EditableStopCard + CoverPicker (Barbiecore, a11y-labelled)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `ItineraryEditor` + owner-only `/plans/[id]/edit` route

**Files:**
- Create: `apps/web/app/plans/[id]/edit/ItineraryEditor.tsx`
- Create: `apps/web/app/plans/[id]/edit/page.tsx`
- Modify: `apps/web/app/plans/[id]/edit/__tests__/ItineraryEditor.test.tsx` (add the editor case)

`ItineraryEditor` (`'use client'`): holds `stops: Stop[]`, `title`, `coverUrl`; renders a `Reorder.Group` of `EditableStopCard`s (reuse the `PhotoManager` pattern: `axis="y"`, `useReducedMotion` → `drag={reduce?false:'y'}`), an "add a stop" button, the `CoverPicker`, and a "save changes" button that runs `validateStopsForSave` then `updateItineraryStops(browserAfter5Client(), {...})` with optimistic toast + rollback. `page.tsx` (RSC): load the itinerary by id with the server client; if no row or `user_id !== user.id`, `notFound()`; else render `<ItineraryEditor>` with the loaded data.

- [ ] **Step 1: Add the failing editor test**

```typescript
// append to apps/web/app/plans/[id]/edit/__tests__/ItineraryEditor.test.tsx
import { ItineraryEditor } from '../ItineraryEditor';
const updateItineraryStops = vi.fn().mockResolvedValue('itin-1');
vi.mock('@after5/api-client', () => ({ updateItineraryStops: (...a: unknown[]) => updateItineraryStops(...a) }));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}) }));
vi.mock('framer-motion', () => ({
  Reorder: { Group: ({ children }: any) => <div>{children}</div>, Item: ({ children }: any) => <div>{children}</div> },
  useReducedMotion: () => true,
}));

describe('ItineraryEditor', () => {
  it('saves edited stops via the RPC', async () => {
    render(<ItineraryEditor itineraryId="itin-1" initialTitle="t" initialCover={null}
      initialStops={[{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }]} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(updateItineraryStops).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itinerary_id: 'itin-1' }));
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `pnpm --filter @after5/web test "app/plans/\[id\]/edit/__tests__/ItineraryEditor.test.tsx"`
Expected: FAIL — `ItineraryEditor` not found.

- [ ] **Step 3: Implement `ItineraryEditor` then `page.tsx`.** Editor props: `{ itineraryId: string; initialStops: Stop[]; initialTitle: string | null; initialCover: string | null }`. Use the Task 4 helpers for all mutations. `page.tsx`:

```tsx
// apps/web/app/plans/[id]/edit/page.tsx
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ItineraryEditor } from './ItineraryEditor';
import type { Stop } from '@/lib/itinerary-types';

export const dynamic = 'force-dynamic';

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/plans/${id}/edit`);
  const { data: it } = await supabase
    .from('itineraries').select('id,user_id,title,cover_image_url,stops').eq('id', id).maybeSingle();
  if (!it || it.user_id !== user.id) notFound();
  return (
    <ItineraryEditor
      itineraryId={it.id}
      initialStops={(Array.isArray(it.stops) ? it.stops : []) as Stop[]}
      initialTitle={it.title}
      initialCover={it.cover_image_url}
    />
  );
}
```

- [ ] **Step 4: Run the editor test + the FULL web suite**

Run: `pnpm --filter @after5/web test "app/plans/\[id\]/edit/__tests__/ItineraryEditor.test.tsx" && pnpm --filter @after5/web test`
Expected: editor + earlier cases PASS; full suite green.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm --filter @after5/web typecheck && (cd apps/web && pnpm exec next lint >/dev/null && echo "lint ok")
git add "apps/web/app/plans/[id]/edit/ItineraryEditor.tsx" "apps/web/app/plans/[id]/edit/page.tsx" "apps/web/app/plans/[id]/edit/__tests__/ItineraryEditor.test.tsx"
git commit -m "feat(m3): ItineraryEditor + owner-only /plans/[id]/edit route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Chromium e2e — edit persists

**Files:**
- Create: `apps/web/e2e/m3-edit.spec.ts`
- Modify: `apps/web/playwright.config.ts:21`

Mock the editor's RPC at the network layer is NOT possible (it's a Supabase RPC over the JS client, not a fetch to a Next route). Instead drive the real flow against the local stack with an authed session (reuse the e2e auth helper used by the 5b/chat specs — find it in `apps/web/e2e/` support files), seeding an owned itinerary via the service-role client, then editing it in the browser and asserting the persisted change after reload. If the e2e auth/seed helper can't create an owned itinerary in-spec, assert the lighter invariant (owner loads the editor, reorders, clicks save, sees the success toast) and log what wasn't covered — do NOT silently weaken.

- [ ] **Step 1: Extend testMatch**

`apps/web/playwright.config.ts` line 21 → `testMatch: /(5b-|chat-|m5-|m2-|m3-).*\.spec\.ts$/,` and update the comment.

- [ ] **Step 2: Write the spec** (follow the authed-session + service-role-seed pattern from `e2e/5b-happy-path.spec.ts`; seed an itinerary owned by the test user, navigate to `/plans/<id>/edit`, change a stop's name via the `name` input, click `save`, expect the success toast; then reload and assert the new name is shown in the editor inputs).

- [ ] **Step 3: Run the m3 e2e (Chromium)**

```bash
cd apps/web
eval "$(supabase status -o env | grep -E '^SERVICE_ROLE_KEY=|^SECRET_KEY=|^PUBLISHABLE_KEY=')"
export SERVICE_ROLE_KEY SECRET_KEY LOCAL_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
pnpm exec playwright test m3-edit
```
Expected: PASS.

- [ ] **Step 4: Run the FULL e2e suite (regression)**

Run: `pnpm exec playwright test`
Expected: all prior specs + m3 green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/m3-edit.spec.ts apps/web/playwright.config.ts
git commit -m "test(m3): Chromium e2e — owner edits an itinerary and the change persists

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (against the locked M3 decisions):**
- Owner-scoped `update_itinerary_stops` validating RPC → Task 1. ✓
- Edit-mode UI: swap/reorder/time/title/note/add/remove → Tasks 4 (helpers), 5 (EditableStopCard), 6 (editor + Reorder). ✓
- Cover-photo picker (from stop photos, no upload bucket) → Task 5 (CoverPicker) + Task 6 (wires `cover_image_url` through the RPC). ✓
- Fork-on-post (published edits don't bleed) → Task 2. ✓ (implemented at post time, the cleanest place: each night gets a private copy, swipes/offers unaffected since they key off `date_instance_id`).
- New `EditableStopCard` (don't thread props into shared `StopCard`) → Task 5. ✓
- Pre-publish edits via a validating RPC → Task 1 (and the fork makes post-publish edits equally safe). ✓
- **DEFERRED, not dropped:** custom venue via Google Places proxy (`/api/places/search`) + inline stop + admin promotion queue. Reason: requires `GOOGLE_PLACES_API_KEY` (task #67), which is unprovisioned — the proxy would 500. Ships as **M3.5 coupled with #67**; mirror the M1 `google-places.ts` normalization (`googleResultToPlaceRow`, `searchText`, `buildPhotoUrl`). Logged here so it isn't silently lost.

**Placeholder scan:** No "TBD"/"handle edge cases"/bare "write tests". Two explicit verify-against-reality callouts (not placeholders): Task 2 Step 4 (whether `s5_post_night.sql` asserts the instance points at the input itinerary — update to accept a fork), and Task 7 (locate the e2e authed-session/seed helper; degrade-with-log if it can't seed an owned itinerary).

**Type consistency:** `Stop` (`@/lib/itinerary-types`) is the single stop type across helpers (Task 4), components (Task 5/6), and the page loader (Task 6). `EditableStop` (api-client, Task 3) is the wire shape and is structurally compatible with `Stop`. `update_itinerary_stops(uuid, jsonb, text, text, text)` signature is identical in the migration (Task 1), the anon-revoke, the wrapper (Task 3), and the SQL test.

**Prod-apply note (for the orchestrator, after CI green):** Tasks 1 + 2 are new prod migrations (`20260602140000`, `20260602140100`). Apply to prod via `apply_migration` in filename order, check drift first, run `get_advisors(security)`, confirm `update_itinerary_stops` + the recreated `post_night` have anon EXECUTE = false / authenticated = true. `post_night` is recreated again here — same 5-arg signature, so `20260602120600`'s anon revoke is reasserted inline. No edge-fn redeploy needed (M3 is DB + frontend only).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-01-m3-date-customization.md`. Recommended: **Subagent-Driven** — backend slice (Tasks 1–3, self-contained) first with DB verification, then UI (Tasks 4–6), then the Chromium e2e (Task 7), then gated prod-apply of the two migrations + push. Custom-venue/Places (M3.5) is deferred to ship with #67.
