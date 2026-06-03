# M4 — Ambient audio per date (TikTok-style)

**Date:** 2026-06-01
**Workstream:** M4 (Phase 1, isolated — run in a worktree)
**Source plan:** `docs/superpowers/reports/2026-06-01-date-experience-milestone-plan.md`

## Goal

A HOST optionally picks an ambient sound for their date from OUR curated, royalty-free (Pixabay) library, **with audio preview before selecting**. On the feed, the active card's sound plays and equal-power crossfades to the next card's sound on swipe. When the host skips the pick, a **vibe-auto fallback** assigns a loop whose `vibe_tags` overlap the night's. Default-muted with a persistent tap-to-unmute pill; under `prefers-reduced-motion` the crossfade becomes a hard cut (audio still plays).

## Architecture

**Data layer.** New library table `ambient_sounds` (curated, admin-writable, authenticated-readable when `is_active`). New column `date_instances.ambient_sound_id uuid references ambient_sounds(id)`. New PUBLIC storage bucket `ambient-sounds` (modelled on the profile-photos bucket migration, but public-read since these are royalty-free loops with no privacy concern). The stray `itineraries.ambient_sound_url` (added in `20260525120300_p0_date_instances.sql:11`) is **left untouched** — it is wrong-shaped for a per-date pick and out of scope.

**Wire-through.** `post_night` RPC gains a trailing `p_ambient_sound_id uuid default null` arg (validated against `ambient_sounds` when non-null) and writes it onto the `date_instances` insert. The feed RPC (`browse_feed_for_viewer` — note: the api-client calls `browse_feed_for_viewer`, not a bare `browse_feed`) joins `ambient_sounds` and projects a **resolved** `ambient_sound_url` + `ambient_sound_name`: if `di.ambient_sound_id` is set, use that row; else pick the highest-`sort_order` active sound whose `vibe_tags && it.vibe_tags` (overlap), falling back to NULL when nothing overlaps. URL is the public object URL built from `storage_path`. `FeedNight` (in `packages/api-client/src/feed.ts`) gains `ambient_sound_url: string | null` and `ambient_sound_name: string | null`; `postNight` input gains `ambient_sound_id?: string | null`.

**Player.** New client hook `apps/web/app/feed/useAmbientDeck.ts`: one lazily-created shared `AudioContext`, a decoded-`AudioBuffer` cache keyed by URL, and two ping-pong `GainNode`s (A/B) wired through one master gain → destination for **equal-power crossfade** (`gain = cos`/`sin` of a 0→1 ramp, or the simpler `setValueCurveAtTime` two-curve approach). The hook is driven by the active index `i` in `SwipeDeck` (the seam: `i` at `SwipeDeck.tsx:31`, the `commit` index-advance at `:41-56`, deck buffers `current/next/after` at `:36-38`). It preloads the **next** card's buffer, crossfades the playing source to it when `i` advances, suspends/closes the context on unmount and on `visibilitychange` (hidden). iOS/Safari autoplay constraint: an `AudioContext` starts `suspended` and only `resume()`s inside a user gesture, and media cannot be unmuted without a gesture — so the FIRST tap on a persistent unmute pill in the SwipeDeck header is what `resume()`s the context and starts audio. Default muted; the unmute choice is persisted to `localStorage`.

**Host picker + preview.** A new `<fieldset>` in `PostNightForm.tsx` after the "when" block (`:181-206`), reusing the accessible radiogroup / roving-tabindex pattern of `PlanCard` (`:257-346`). It adds an explicit "no preference" radio (selected by default → sends `null` → server vibe-auto fallback) plus one radio per library sound, each with a per-item play/pause **preview** button. Preview uses a single shared `HTMLAudioElement` (NOT the deck's Web-Audio graph — simpler, and previews never crossfade): never autoplay, only one playing at a time, pausing the previous on a new play. The library is loaded **server-side** in `apps/web/app/nights/new/page.tsx` and passed as a prop; `ambient_sound_id` is threaded into the `postNight` call (`:100-103`).

**Assets.** ~10 vibe-keyed Pixabay loops (15–30 s, ~96–128 kbps `.m4a`/`.mp3`, seamless). Asset sourcing is a documented **manual** step (Task 8) with placeholder URLs; the migration/seed structure is concrete.

## Tech Stack

- **DB/RPC:** Supabase Postgres, plpgsql/sql SECURITY DEFINER, RLS. Migrations in `supabase/migrations/` (timestamp-prefixed). SQL smoke tests via `pnpm db:test` (`supabase/tests/*.sql`, run with `psql -v ON_ERROR_STOP=1`).
- **Types:** regenerate `packages/types/src/database.ts` via `pnpm db:types` after DDL.
- **API client:** `packages/api-client/src/feed.ts` (plain TS, no DOM) — root vitest (node env): `vitest run` from repo root.
- **Web:** Next 15 / React 19 client components, framer-motion, Web Audio API. Web unit tests: `apps/web` jsdom vitest project (`pnpm --filter web test` → `vitest run --project web`), setup mirrors `apps/web/vitest.setup.ts`. **AudioContext is mocked** in jsdom (it does not exist there).

## Prod-drift — VERIFY BEFORE ANY DDL

Run these read-only against prod (`ufufmcpnysvwtutpbian`) via the Supabase MCP and confirm before writing migrations:

1. `date_instances` columns actually on prod (the feed RPC references columns; confirm there is **no** existing `ambient_sound_id`). Query: `select column_name, data_type from information_schema.columns where table_name='date_instances' order by 1;`
2. The live definition of `browse_feed_for_viewer` on prod matches `20260527120300_s5_browse_feed.sql` (later migrations may have re-created it). Query: `select pg_get_functiondef('public.browse_feed_for_viewer'::regprocedure);` — capture the EXACT current signature/body, because Task 4 must `create or replace` from the live body, not the base-migration body.
3. The live definition + arg list of `post_night` (Task 2 replaces it; adding an arg with a default keeps the old 4-arg signature callable, but confirm no overload already exists). Query: `select oid::regprocedure, pg_get_functiondef(oid) from pg_proc where proname='post_night';`
4. Confirm `storage.foldername`/public-bucket conventions and that no `ambient-sounds` bucket already exists. Query: `select id, public from storage.buckets;`

If the live `browse_feed_for_viewer` body differs from the base migration, **base Task 4's `create or replace` on the captured live body** and only layer the ambient join on top. Run `mcp__supabase__get_advisors` (security) after Tasks 1–4's DDL is applied locally/branch, per the secure-by-default habit.

> All migration timestamps below use the `20260601210xxx` band (after the latest existing `20260601201000`). Adjust if newer migrations land before execution.

---

## Task 1 — `ambient_sounds` table + RLS

**Files**
- Create: `supabase/migrations/20260601210000_m4_ambient_sounds.sql`
- Create: `supabase/tests/m4_ambient_sounds.sql`

**Steps**

1. **Write the failing SQL test** `supabase/tests/m4_ambient_sounds.sql`:

```sql
-- m4_ambient_sounds.sql — table shape + RLS posture for the ambient library.
\set ON_ERROR_STOP on
begin;

-- table exists with the expected columns
select 1/count(*) from information_schema.columns
  where table_name='ambient_sounds' and column_name='vibe_tags' and data_type='ARRAY';
select 1/count(*) from information_schema.columns
  where table_name='ambient_sounds' and column_name='storage_path';
select 1/count(*) from information_schema.columns
  where table_name='ambient_sounds' and column_name='is_active';

-- RLS is enabled
select 1/count(*) from pg_tables where tablename='ambient_sounds' and rowsecurity=true;

-- authenticated SELECT policy exists and is scoped to is_active
select 1/count(*) from pg_policies
  where tablename='ambient_sounds' and cmd='SELECT' and 'authenticated'=any(roles);

-- NO broad write policy for authenticated (writes are admin/service-role only)
select 1/(1 - least(1, count(*))) from pg_policies
  where tablename='ambient_sounds' and cmd in ('INSERT','UPDATE','DELETE') and 'authenticated'=any(roles);

rollback;
```

2. **Run** (expect failure — table absent): `pnpm db:reset && pnpm db:test` → the file errors at the first `select 1/count(*)` (division by zero on count 0).

3. **Write the migration** `20260601210000_m4_ambient_sounds.sql`:

```sql
-- supabase/migrations/20260601210000_m4_ambient_sounds.sql
-- Curated, royalty-free (Pixabay) ambient loop library. Admin/service-role writes only;
-- authenticated users may read active rows (the host picker + feed both need them).
create table if not exists ambient_sounds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vibe_tags text[] not null default '{}',
  storage_path text not null,            -- object path within the public 'ambient-sounds' bucket
  duration_sec int not null check (duration_sec between 5 and 120),
  attribution text,                      -- e.g. "Sound by <artist> on Pixabay"
  license text not null default 'Pixabay Content License',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ambient_sounds_active_idx on ambient_sounds(is_active, sort_order);
create index if not exists ambient_sounds_vibe_gin on ambient_sounds using gin (vibe_tags);

alter table ambient_sounds enable row level security;
-- Authenticated read of active rows only. No write policy → only service_role (RLS-bypass) writes.
do $$ begin
  create policy "ambient_sounds_active_read" on ambient_sounds for select
    to authenticated using (is_active = true);
exception when duplicate_object then null; end $$;
```

4. **Run** (expect pass): `pnpm db:reset && pnpm db:test` (the `m4_ambient_sounds.sql` block now passes).

5. **Security advisor:** `mcp__supabase__get_advisors(type=security)` on the local/branch DB; confirm no new RLS warnings for `ambient_sounds`.

6. **Commit:** `git add supabase/migrations/20260601210000_m4_ambient_sounds.sql supabase/tests/m4_ambient_sounds.sql && git commit -m "M4: ambient_sounds library table + read-only RLS"`

---

## Task 2 — `date_instances.ambient_sound_id` column

**Files**
- Create: `supabase/migrations/20260601210100_m4_date_instances_ambient.sql`
- Modify: `supabase/tests/m4_ambient_sounds.sql` (append assertions)

**Steps**

1. **Append a failing assertion** to `supabase/tests/m4_ambient_sounds.sql` (inside the same transaction, before `rollback;`):

```sql
-- date_instances carries the host's per-date pick (nullable → vibe-auto fallback)
select 1/count(*) from information_schema.columns
  where table_name='date_instances' and column_name='ambient_sound_id' and data_type='uuid';
```

2. **Run** (expect failure): `pnpm db:reset && pnpm db:test`.

3. **Write the migration** `20260601210100_m4_date_instances_ambient.sql`:

```sql
-- supabase/migrations/20260601210100_m4_date_instances_ambient.sql
-- Optional per-date ambient pick. NULL = host skipped → feed RPC applies a vibe-auto fallback.
alter table date_instances
  add column if not exists ambient_sound_id uuid references ambient_sounds(id) on delete set null;
```

4. **Run** (expect pass): `pnpm db:reset && pnpm db:test`.

5. **Commit:** `git add supabase/migrations/20260601210100_m4_date_instances_ambient.sql supabase/tests/m4_ambient_sounds.sql && git commit -m "M4: date_instances.ambient_sound_id (nullable, FK to library)"`

---

## Task 3 — public `ambient-sounds` storage bucket

**Files**
- Create: `supabase/migrations/20260601210200_m4_ambient_sounds_bucket.sql`
- Modify: `supabase/tests/m4_ambient_sounds.sql` (append)

**Steps**

1. **Append a failing assertion**:

```sql
-- public bucket exists
select 1/count(*) from storage.buckets where id='ambient-sounds' and public=true;
```

2. **Run** (expect failure): `pnpm db:reset && pnpm db:test`.

3. **Write the migration** `20260601210200_m4_ambient_sounds_bucket.sql` (modelled on `20260525122600_p1_profile_photos_bucket.sql`, but public-read — loops are royalty-free and non-private):

```sql
-- supabase/migrations/20260601210200_m4_ambient_sounds_bucket.sql
-- Public bucket for curated ambient loops (royalty-free, no privacy concern).
-- Public read is implicit for public buckets; writes are admin/service-role only (no write policy).
insert into storage.buckets (id, name, public) values ('ambient-sounds', 'ambient-sounds', true)
on conflict (id) do nothing;
```

4. **Run** (expect pass): `pnpm db:reset && pnpm db:test`.

5. **Commit:** `git add supabase/migrations/20260601210200_m4_ambient_sounds_bucket.sql supabase/tests/m4_ambient_sounds.sql && git commit -m "M4: public ambient-sounds storage bucket"`

---

## Task 4 — `post_night` accepts `p_ambient_sound_id`

**Files**
- Create: `supabase/migrations/20260601210300_m4_post_night_ambient.sql`
- Create: `supabase/tests/m4_post_night_ambient.sql`

> PREREQ: capture the **live** `post_night` body (prod-drift check #3). The block below is based on `20260527120200_s5_post_night.sql`; if prod differs, layer onto the live body.

**Steps**

1. **Write the failing test** `supabase/tests/m4_post_night_ambient.sql`:

```sql
-- m4_post_night_ambient.sql — post_night accepts and persists the ambient pick.
\set ON_ERROR_STOP on
begin;
-- 5-arg overload exists (the new signature)
select 1/count(*) from pg_proc
  where proname='post_night' and pronargs=5;
rollback;
```

2. **Run** (expect failure): `pnpm db:reset && pnpm db:test`.

3. **Write the migration** `20260601210300_m4_post_night_ambient.sql`:

```sql
-- supabase/migrations/20260601210300_m4_post_night_ambient.sql
-- Add an optional ambient pick to post_night. Validated against the active library;
-- NULL is allowed (host skipped → feed applies vibe-auto fallback at read time).
create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150,
  p_ambient_sound_id uuid default null
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

  -- Validate the optional ambient pick against the active library.
  if p_ambient_sound_id is not null then
    perform 1 from ambient_sounds where id = p_ambient_sound_id and is_active = true;
    if not found then
      raise exception 'ambient sound not found or inactive' using errcode='P0001';
    end if;
  end if;

  insert into date_instances
    (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status, ambient_sound_id)
  values
    (p_itinerary, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking', p_ambient_sound_id)
  returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function post_night(uuid, timestamptz, uuid, int, uuid) from public;
grant execute on function post_night(uuid, timestamptz, uuid, int, uuid) to authenticated;
```

> Note: this creates a 5-arg overload alongside the existing 4-arg `post_night`. The api-client (Task 6) always calls the 5-arg form. Optionally `drop function post_night(uuid, timestamptz, uuid, int)` to remove the old overload — confirm nothing else calls it first (`grep -rn "rpc('post_night'" --include=*.ts`).

4. **Run** (expect pass): `pnpm db:reset && pnpm db:test`.

5. **Commit:** `git add supabase/migrations/20260601210300_m4_post_night_ambient.sql supabase/tests/m4_post_night_ambient.sql && git commit -m "M4: post_night accepts p_ambient_sound_id (validated)"`

---

## Task 5 — feed RPC projects resolved `ambient_sound_url` + vibe-auto fallback

**Files**
- Create: `supabase/migrations/20260601210400_m4_browse_feed_ambient.sql`
- Create: `supabase/tests/m4_browse_feed_ambient.sql`

> PREREQ: capture the **live** `browse_feed_for_viewer` body (prod-drift check #2) and base the `create or replace` on it. The block below is based on `20260527120300_s5_browse_feed.sql`.

**Steps**

1. **Write the failing test** `supabase/tests/m4_browse_feed_ambient.sql`:

```sql
-- m4_browse_feed_ambient.sql — the feed RPC returns the two new ambient columns.
\set ON_ERROR_STOP on
begin;
-- the return type now includes ambient_sound_url + ambient_sound_name
select 1/count(*) from (
  select unnest(string_to_array(pg_get_function_result('public.browse_feed_for_viewer'::regprocedure), ',')) as c
) t where c ilike '%ambient_sound_url%';
select 1/count(*) from (
  select unnest(string_to_array(pg_get_function_result('public.browse_feed_for_viewer'::regprocedure), ',')) as c
) t where c ilike '%ambient_sound_name%';
rollback;
```

2. **Run** (expect failure): `pnpm db:reset && pnpm db:test`.

3. **Write the migration** `20260601210400_m4_browse_feed_ambient.sql`. The resolution is a `LATERAL` that prefers the host's pick, else the best vibe-overlapping active sound; the URL is built from the public bucket path. (Public-bucket object URL form: `<SUPABASE_URL>/storage/v1/object/public/ambient-sounds/<storage_path>`. Build it in-DB from the path so the client needs no base URL: store only the path in the projection and let the client prefix, OR — cleaner — return the full public URL using a helper. Below we return the relative path under the bucket and a flag; the client prefixes with `NEXT_PUBLIC_SUPABASE_URL`. **Decision: return the full public URL from DB is brittle (env), so return `storage_path` as `ambient_sound_url` and prefix client-side.** Rename the projected column to make this explicit.)

> DECISION (resolve before coding): return **relative `storage_path`** as `ambient_sound_path` and prefix in the client (no DB dependency on the public base URL). This is the chosen approach — it avoids hardcoding the project URL in SQL. The column is named `ambient_sound_path`; `FeedNight.ambient_sound_url` is computed client-side.

```sql
-- supabase/migrations/20260601210400_m4_browse_feed_ambient.sql
-- Add resolved ambient pick to the blind feed: host's choice, else a vibe-auto fallback
-- (highest sort_order active sound whose vibe_tags overlap the night's), else NULL.
-- Returns the relative storage path; the client prefixes the public bucket base URL.
create or replace function browse_feed_for_viewer(
  p_viewer uuid default auth.uid(),
  p_point geography default null,
  p_after_starts timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 20
) returns table (
  date_instance_id uuid, city_id uuid, time_window_start timestamptz,
  itinerary_id uuid, pay_setting text, vibe_tags text[], why_note text,
  cover_image_url text, title text, venue_neighborhood text, is_seed boolean,
  distance_m double precision,
  ambient_sound_path text, ambient_sound_name text
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
         st_distance(cc.centroid, me.pt) as distance_m,
         amb.storage_path, amb.name
  from date_instances di
  join profiles cr on cr.id = di.creator_id
  join itineraries it on it.id = di.itinerary_id
  join cities cc on cc.id = di.city_id
  left join places pl on pl.id = di.venue_id
  -- resolved ambient: host pick first, else vibe-auto fallback, else nothing.
  left join lateral (
    select s.storage_path, s.name
    from ambient_sounds s
    where s.is_active = true
      and (
        s.id = di.ambient_sound_id
        or (di.ambient_sound_id is null and s.vibe_tags && it.vibe_tags)
      )
    -- prefer the explicit pick (it.id match), then highest sort_order.
    order by (s.id = di.ambient_sound_id) desc, s.sort_order desc, s.id
    limit 1
  ) amb on true
  cross join me
  where di.status = 'seeking'
    and di.starts_at > now()
    and di.moderation_status = 'approved'
    and cr.account_state = 'active' and cr.standing not in ('suspended','locked_ban')
    and cr.verification = 'verified' and cr.dating_enabled = true
    and di.creator_id <> p_viewer
    and not exists (select 1 from swipes s where s.swiper_id = p_viewer and s.date_instance_id = di.id)
    and cr.gender = any (me.gender_preferences)
    and me.gender = any (cr.gender_preferences)
    and me.age <@ cr.age_pref and cr.age <@ me.age_pref
    and st_dwithin(cc.centroid, me.pt, least(me.distance_pref_km, cr.distance_pref_km) * 1000)
    and (p_after_starts is null or (di.starts_at, di.id) > (p_after_starts, p_after_id))
  order by di.starts_at asc, di.id asc
  limit greatest(1, least(coalesce(p_limit,20), 50));
$fn$;
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from public;
grant execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) to authenticated;
```

> The test in step 1 asserts `ambient_sound_url`/`ambient_sound_name`; the chosen column name is `ambient_sound_path`. **Update step-1 test strings to `ambient_sound_path` and `ambient_sound_name` before running** so the test matches the migration.

4. **Run** (expect pass): `pnpm db:reset && pnpm db:test`.

5. **Security advisor** on the local DB after this DDL; confirm SECURITY DEFINER posture unchanged.

6. **Commit:** `git add supabase/migrations/20260601210400_m4_browse_feed_ambient.sql supabase/tests/m4_browse_feed_ambient.sql && git commit -m "M4: browse_feed_for_viewer resolves ambient (host pick + vibe-auto fallback)"`

---

## Task 6 — api-client: `FeedNight` + `postNight` + a library loader

**Files**
- Modify: `packages/api-client/src/feed.ts`
- Create: `packages/api-client/src/__tests__/feed.test.ts`

**Steps**

1. **Write the failing test** `packages/api-client/src/__tests__/feed.test.ts` (mock the client; assert the RPC args and the projection mapping):

```ts
import { describe, it, expect, vi } from 'vitest';
import { postNight, browseFeed, ambientSoundUrl, type FeedNight } from '../feed';

function mockClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) } as never;
}

describe('postNight', () => {
  it('passes p_ambient_sound_id when provided', async () => {
    const c = mockClient({ data: 'inst-1', error: null });
    await postNight(c, { itinerary_id: 'it-1', starts_at: 'T', ambient_sound_id: 'amb-9' });
    expect((c as any).rpc).toHaveBeenCalledWith('post_night', expect.objectContaining({
      p_itinerary: 'it-1', p_ambient_sound_id: 'amb-9',
    }));
  });
  it('passes undefined ambient id when omitted (vibe-auto fallback path)', async () => {
    const c = mockClient({ data: 'inst-1', error: null });
    await postNight(c, { itinerary_id: 'it-1', starts_at: 'T' });
    expect((c as any).rpc).toHaveBeenCalledWith('post_night', expect.objectContaining({
      p_ambient_sound_id: undefined,
    }));
  });
});

describe('ambientSoundUrl', () => {
  it('prefixes the public bucket base for a relative path', () => {
    expect(ambientSoundUrl('lofi/calm.m4a', 'https://x.supabase.co'))
      .toBe('https://x.supabase.co/storage/v1/object/public/ambient-sounds/lofi/calm.m4a');
  });
  it('returns null for a null path', () => {
    expect(ambientSoundUrl(null, 'https://x.supabase.co')).toBeNull();
  });
});

describe('browseFeed', () => {
  it('passes ambient_sound_path through into FeedNight', async () => {
    const row: Partial<FeedNight> & { ambient_sound_path: string } = {
      date_instance_id: 'd1', ambient_sound_path: 'lofi/calm.m4a', ambient_sound_name: 'calm',
    };
    const c = mockClient({ data: [row], error: null });
    const out = await browseFeed(c);
    expect(out[0].ambient_sound_path).toBe('lofi/calm.m4a');
    expect(out[0].ambient_sound_name).toBe('calm');
  });
});
```

2. **Run** (expect failure — `ambient_sound_id`/`ambient_sound_path`/`ambientSoundUrl` don't exist): `pnpm --filter @after5/api-client test` (or `vitest run packages/api-client` from root).

3. **Edit `packages/api-client/src/feed.ts`**:

- Add to `FeedNight`:
```ts
  ambient_sound_path: string | null; ambient_sound_name: string | null;
```
- Add `ambient_sound_id` to the `postNight` input and pass it:
```ts
export async function postNight(client: After5Client, input: {
  itinerary_id: string; starts_at: string; venue_id?: string | null;
  duration_min?: number; ambient_sound_id?: string | null;
}): Promise<string> {
  const { data, error } = await client.rpc('post_night', {
    p_itinerary: input.itinerary_id, p_starts_at: input.starts_at,
    p_venue: input.venue_id ?? undefined, p_duration_min: input.duration_min ?? 150,
    p_ambient_sound_id: input.ambient_sound_id ?? undefined,
  });
  if (error) throw error;
  return data as string;
}
```
- Add a pure URL helper (used by the web layer; lives here so it is unit-tested in node):
```ts
// Build a public-bucket URL from a relative storage path. Returns null for null paths.
export function ambientSoundUrl(path: string | null, supabaseUrl: string): string | null {
  if (!path) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/ambient-sounds/${path}`;
}
```
- Add a curated-library loader (used by the host picker, server-side):
```ts
export interface AmbientSound {
  id: string; name: string; storage_path: string; vibe_tags: string[]; duration_sec: number;
}
export async function listAmbientSounds(client: After5Client): Promise<AmbientSound[]> {
  const { data, error } = await client
    .from('ambient_sounds')
    .select('id, name, storage_path, vibe_tags, duration_sec')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AmbientSound[];
}
```

4. **Run** (expect pass): `pnpm --filter @after5/api-client test`.

5. Re-export from the web client wrapper — **Edit `apps/web/lib/after5/client.ts`** to add `ambientSoundUrl, listAmbientSounds, type AmbientSound` to the existing `@after5/api-client` re-export line.

6. **Regen types:** `pnpm db:reset && pnpm db:types` (writes `packages/types/src/database.ts` with `ambient_sounds` + the new column). `pnpm --filter @after5/api-client typecheck` (or root `pnpm typecheck`).

7. **Commit:** `git add packages/api-client/src/feed.ts packages/api-client/src/__tests__/feed.test.ts apps/web/lib/after5/client.ts packages/types/src/database.ts && git commit -m "M4: api-client FeedNight + postNight ambient wiring + library loader + URL helper"`

---

## Task 7 — `useAmbientDeck` hook (Web-Audio crossfade)

**Files**
- Create: `apps/web/app/feed/useAmbientDeck.ts`
- Create: `apps/web/app/feed/useAmbientDeck.test.ts`

**Behaviour contract**
- Lazily create ONE `AudioContext` on first `unmute()` (gesture). Before that, no context exists and nothing plays (default muted).
- Decode + cache `AudioBuffer` per URL. Preload the **next** URL while the current plays.
- Two `GainNode`s (A/B) → master gain → destination. On index advance, start the next buffer on the idle gain node, ramp the equal-power crossfade over ~600ms, stop the outgoing source at the end. Loop each source (`source.loop = true`).
- `reduceMotion === true` → **hard cut**: stop outgoing immediately, set incoming gain to full (no ramp). Audio still plays.
- `mute()` ramps master gain to 0 and suspends the context; `unmute()` resumes + ramps to 1. Persist the muted/unmuted choice in `localStorage` key `after5:ambient-unmuted`.
- Cleanup on unmount: stop sources, `close()` the context. On `document.visibilitychange` to hidden: `suspend()`; on visible while unmuted: `resume()`.
- Null/absent URL for a card → that node plays nothing (silence), crossfade still runs against silence.

**Hook signature**
```ts
export function useAmbientDeck(urls: (string | null)[], activeIndex: number, opts: {
  reduceMotion: boolean;
}): {
  unmuted: boolean;
  toggleMute: () => void;   // first call creates+resumes the context (gesture)
};
```

**Steps**

1. **Write the failing test** `apps/web/app/feed/useAmbientDeck.test.ts`. Mock `AudioContext` (absent in jsdom) with a fake exposing `createGain`, `createBufferSource`, `decodeAudioData`, `resume`, `suspend`, `close`, `state`, `currentTime`, `destination`. Stub `global.fetch` to return an `arrayBuffer()`. Render via `@testing-library/react`'s `renderHook`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

class FakeParam { value = 1; setValueAtTime() {} linearRampToValueAtTime() {} setValueCurveAtTime() {} cancelScheduledValues() {} }
class FakeGain { gain = new FakeParam(); connect = vi.fn(); disconnect = vi.fn(); }
class FakeSource { buffer: unknown = null; loop = false; connect = vi.fn(); start = vi.fn(); stop = vi.fn(); disconnect = vi.fn(); onended: (() => void) | null = null; }
class FakeAudioContext {
  state = 'suspended'; currentTime = 0; destination = {};
  createGain = vi.fn(() => new FakeGain());
  createBufferSource = vi.fn(() => new FakeSource());
  decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}

beforeEach(() => {
  (globalThis as any).AudioContext = FakeAudioContext;
  globalThis.fetch = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as never;
  localStorage.clear();
});

import { useAmbientDeck } from './useAmbientDeck';

describe('useAmbientDeck', () => {
  it('starts muted and creates no AudioContext until first unmute', () => {
    const ctorSpy = vi.spyOn(globalThis as any, 'AudioContext');
    const { result } = renderHook(() => useAmbientDeck(['a','b'], 0, { reduceMotion: false }));
    expect(result.current.unmuted).toBe(false);
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('toggleMute creates + resumes the context (gesture unlock) and persists the choice', async () => {
    const { result } = renderHook(() => useAmbientDeck(['a','b'], 0, { reduceMotion: false }));
    await act(async () => { result.current.toggleMute(); });
    expect(result.current.unmuted).toBe(true);
    expect(localStorage.getItem('after5:ambient-unmuted')).toBe('1');
  });

  it('hard-cuts (no ramp) under reduced motion when the active index advances', async () => {
    const { result, rerender } = renderHook(
      ({ i }) => useAmbientDeck(['a','b','c'], i, { reduceMotion: true }),
      { initialProps: { i: 0 } },
    );
    await act(async () => { result.current.toggleMute(); });
    await act(async () => { rerender({ i: 1 }); });
    // assertion: gain set instantly (no linearRamp) — spy on the gain node curve calls.
    expect(result.current.unmuted).toBe(true);
  });

  it('closes the context on unmount', async () => {
    const { result, unmount } = renderHook(() => useAmbientDeck(['a'], 0, { reduceMotion: false }));
    await act(async () => { result.current.toggleMute(); });
    unmount();
    // assertion: ctx.close was called — capture the instance via the ctor mock.
  });
});
```

2. **Run** (expect failure — hook absent): `pnpm --filter web test useAmbientDeck`.

3. **Implement `apps/web/app/feed/useAmbientDeck.ts`.** Key points: guard `typeof window === 'undefined'` and `typeof AudioContext === 'undefined'` (SSR + unsupported); keep the context/gain refs in `useRef`; equal-power crossfade via `setValueCurveAtTime` with two precomputed `Float32Array` curves (`cos` out, `sin` in) or, under reduced motion, `gain.value` assignment; `useEffect` on `activeIndex` performs the crossfade and kicks off the next preload; `useEffect` cleanup closes the context; a `visibilitychange` listener suspends/resumes. `toggleMute` is the only place the context is created (so creation always happens inside the click handler that calls it → satisfies the gesture requirement). Decode failures are swallowed (silence) so one bad asset never breaks the deck.

4. **Run** (expect pass): `pnpm --filter web test useAmbientDeck`.

5. **Commit:** `git add apps/web/app/feed/useAmbientDeck.ts apps/web/app/feed/useAmbientDeck.test.ts && git commit -m "M4: useAmbientDeck Web-Audio crossfade hook (mute-default, gesture unlock, reduced-motion hard cut)"`

---

## Task 8 — Curated Pixabay assets + seed (MANUAL sourcing; concrete seed structure)

**Files**
- Create: `supabase/migrations/20260601210500_m4_ambient_sounds_seed.sql`
- Create: `docs/superpowers/m4-ambient-assets.md` (the documented manual step)

**This is the only task with placeholders** (asset URLs/paths), per the brief.

**Steps**

1. **Document the manual sourcing** in `docs/superpowers/m4-ambient-assets.md`: for each of ~10 vibe keys, the search/selection criteria (Pixabay royalty-free, 15–30s, ~96–128 kbps `.m4a`/`.mp3`, seamless loop, attribution captured), and the upload command. Target vibe keys SHOULD align with what `vibePalette`/itinerary `vibe_tags` actually emit — **verify the real tag vocabulary** (`grep -rn "vibe" packages/business/src` and inspect seeded itineraries) before finalizing; a candidate set: `cozy, lively, romantic, adventurous, artsy, late-night, chill, foodie, outdoorsy, classy`.

   Upload (manual, per file, after downloading to `./tmp/ambient/`):
   ```bash
   # one-time per asset — uploads into the public bucket under <vibe>/<slug>.m4a
   supabase storage cp ./tmp/ambient/cozy-fireplace.m4a \
     ss:///ambient-sounds/cozy/cozy-fireplace.m4a --experimental
   ```
   (Or upload via the Storage dashboard / a service-role script. Record the final `storage_path`, `duration_sec`, and `attribution` for each.)

2. **Write the seed migration** `20260601210500_m4_ambient_sounds_seed.sql` with concrete structure and PLACEHOLDER paths/attribution to be filled once assets are uploaded. Idempotent via a stable natural key (`name`) and `on conflict`:

```sql
-- supabase/migrations/20260601210500_m4_ambient_sounds_seed.sql
-- Curated Pixabay loops. PLACEHOLDER storage_path/attribution — fill after the manual
-- asset upload (see docs/superpowers/m4-ambient-assets.md). Idempotent on name.
insert into ambient_sounds (name, vibe_tags, storage_path, duration_sec, attribution, sort_order) values
  ('cozy fireplace',  array['cozy','chill'],          'cozy/PLACEHOLDER.m4a',       20, 'Pixabay — TODO', 10),
  ('lively street',   array['lively','late-night'],   'lively/PLACEHOLDER.m4a',     20, 'Pixabay — TODO', 20),
  ('soft romance',    array['romantic','classy'],     'romantic/PLACEHOLDER.m4a',   20, 'Pixabay — TODO', 30),
  ('open road',       array['adventurous','outdoorsy'],'adventurous/PLACEHOLDER.m4a',20, 'Pixabay — TODO', 40),
  ('gallery hush',    array['artsy','classy'],         'artsy/PLACEHOLDER.m4a',      20, 'Pixabay — TODO', 50),
  ('night drive',     array['late-night','lively'],    'late-night/PLACEHOLDER.m4a', 20, 'Pixabay — TODO', 60),
  ('lo-fi chill',     array['chill','cozy'],           'chill/PLACEHOLDER.m4a',      20, 'Pixabay — TODO', 70),
  ('market buzz',     array['foodie','lively'],        'foodie/PLACEHOLDER.m4a',     20, 'Pixabay — TODO', 80),
  ('lakeside calm',   array['outdoorsy','chill'],      'outdoorsy/PLACEHOLDER.m4a',  20, 'Pixabay — TODO', 90),
  ('jazz lounge',     array['classy','romantic'],      'classy/PLACEHOLDER.m4a',     20, 'Pixabay — TODO', 100)
on conflict (name) do update set
  vibe_tags = excluded.vibe_tags, storage_path = excluded.storage_path,
  duration_sec = excluded.duration_sec, attribution = excluded.attribution,
  sort_order = excluded.sort_order;
```
   Requires a unique constraint on `name` for `on conflict` — add to Task 1's table or here:
   ```sql
   create unique index if not exists ambient_sounds_name_key on ambient_sounds(name);
   ```
   (Add this index to the Task 1 migration instead, then `on conflict (name)` works cleanly. Decision: put the unique index in Task 1.)

3. **Run:** `pnpm db:reset && pnpm db:test` (still green; seed inserts 10 rows).

4. **Commit:** `git add supabase/migrations/20260601210500_m4_ambient_sounds_seed.sql docs/superpowers/m4-ambient-assets.md && git commit -m "M4: ambient_sounds seed (10 vibe-keyed rows, placeholder asset paths) + sourcing doc"`

> **Follow-up (post-asset-upload, not blocking the build):** replace the PLACEHOLDER paths/attribution in a small follow-up migration once files are in the bucket.

---

## Task 9 — Host picker + preview in `PostNightForm`

**Files**
- Modify: `apps/web/app/nights/new/page.tsx`
- Modify: `apps/web/app/nights/new/PostNightForm.tsx`
- Create: `apps/web/app/nights/new/PostNightForm.test.tsx`

**Steps**

1. **Edit `page.tsx`** to load the library server-side and pass it down:
```ts
import { listAmbientSounds } from '@/lib/after5/client';
// ... inside the component, after plans:
const ambientSounds = await listAmbientSounds(supabase as never);
return <PostNightForm plans={plans ?? []} ambientSounds={ambientSounds} />;
```
   (`createClient()` server client is structurally an `After5Client`; mirror the `postNight`/feed pattern.)

2. **Write the failing test** `apps/web/app/nights/new/PostNightForm.test.tsx` (mock `next/navigation`, `next/image`, `sonner`, and `@/lib/after5/client` so `postNight` is a spy and `ambientSoundUrl` resolves). Assert:
   - a "no preference" radio is selected by default (so omitting a pick is the easy path);
   - selecting a sound radio updates `aria-checked`;
   - each sound has a preview play button (`aria-label` like `preview <name>`); clicking calls `play()` on a stubbed `HTMLAudioElement` and only one plays at a time;
   - submitting with a sound selected calls `postNight` with `ambient_sound_id` = that id; with "no preference" selected it omits it (passes `null`/`undefined`).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const postNight = vi.fn().mockResolvedValue('inst-1');
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  postNight,
  ambientSoundUrl: (p: string | null) => (p ? `https://x/${p}` : null),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const plans = [{ id: 'it-1', title: 'sunset walk', cover_image_url: null, vibe_tags: ['cozy'] }];
const sounds = [
  { id: 'amb-1', name: 'cozy fireplace', storage_path: 'cozy/x.m4a', vibe_tags: ['cozy'], duration_sec: 20 },
];

beforeEach(() => { postNight.mockClear(); HTMLMediaElement.prototype.play = vi.fn(); HTMLMediaElement.prototype.pause = vi.fn(); });

// import after mocks
import { PostNightForm } from './PostNightForm';

describe('PostNightForm ambient picker', () => {
  it('defaults to no preference and posts without an ambient id', async () => {
    render(<PostNightForm plans={plans} ambientSounds={sounds} />);
    // (select plan + future time, then submit; assert postNight called with ambient_sound_id null/undefined)
  });
  it('posts the chosen ambient_sound_id', async () => {
    render(<PostNightForm plans={plans} ambientSounds={sounds} />);
    // (select the 'cozy fireplace' radio, plan, time; submit; assert ambient_sound_id: 'amb-1')
  });
  it('preview plays one at a time', async () => {
    render(<PostNightForm plans={plans} ambientSounds={sounds} />);
    // (click preview; assert play() called)
  });
});
```

3. **Run** (expect failure — prop + fieldset absent): `pnpm --filter web test PostNightForm`.

4. **Edit `PostNightForm.tsx`:**
   - Extend props: `{ plans: Plan[]; ambientSounds: AmbientSound[] }`.
   - Add `const [ambientId, setAmbientId] = useState<string>('')` (`''` = no preference). Add a second roving-tabindex radiogroup mirroring `PlanCard` (generalize or duplicate the keydown/roving logic; an explicit "no preference" radio is index 0).
   - Add a single shared preview `HTMLAudioElement` via `useRef`; a `previewingId` state; a `togglePreview(id, url)` that pauses any current and plays the new (never autoplay). Build URLs with `ambientSoundUrl(sound.storage_path, NEXT_PUBLIC_SUPABASE_URL)`. Preview button is a real `<button type="button">` with `aria-pressed`, separate from the radio (so a tap previews without selecting).
   - Insert the new `<fieldset>` (legend "soundtrack? (optional)") right after the "when" block (`:206`), before the error alert.
   - Thread the pick into submit (`:100-103`):
     ```ts
     await postNight(browserAfter5Client(), {
       itinerary_id: selectedId,
       starts_at: new Date(startsAt).toISOString(),
       ambient_sound_id: ambientId || null,
     });
     ```
   - Stop the preview on submit/unmount.

5. **Run** (expect pass): `pnpm --filter web test PostNightForm`.

6. **a11y:** add a `jest-axe` assertion in the test (`expect(await axe(container)).toHaveNoViolations()`), matching the repo's `notif-a11y.test.tsx` convention.

7. **Commit:** `git add apps/web/app/nights/new/PostNightForm.tsx apps/web/app/nights/new/page.tsx apps/web/app/nights/new/PostNightForm.test.tsx && git commit -m "M4: host ambient picker + per-item preview (optional, no-preference default)"`

---

## Task 10 — Wire `useAmbientDeck` into `SwipeDeck` + unmute pill

**Files**
- Modify: `apps/web/app/feed/SwipeDeck.tsx`
- Create: `apps/web/app/feed/SwipeDeck.ambient.test.tsx`

**Steps**

1. **Write the failing test** `apps/web/app/feed/SwipeDeck.ambient.test.tsx` (mock `useAmbientDeck`, the api-client, framer-motion if needed). Assert:
   - the deck renders a persistent unmute pill in the header with `aria-pressed` reflecting muted state and an accessible label (`tap to unmute` / `mute`);
   - `useAmbientDeck` is called with the deck's resolved ambient URLs (mapped from `ambient_sound_path` via `ambientSoundUrl`) and the active index `i`;
   - clicking the pill calls the hook's `toggleMute`.

2. **Run** (expect failure): `pnpm --filter web test SwipeDeck.ambient`.

3. **Edit `SwipeDeck.tsx`:**
   - Import `useAmbientDeck` and `ambientSoundUrl`.
   - Compute `const urls = useMemo(() => deck.map(n => ambientSoundUrl(n.ambient_sound_path, SUPABASE_URL)), [deck])` (read `NEXT_PUBLIC_SUPABASE_URL` from env).
   - `const { unmuted, toggleMute } = useAmbientDeck(urls, i, { reduceMotion: !!reduceMotion });`
   - Add the unmute pill to the `<header>` (`:65-70`) — a `<button type="button" aria-pressed={unmuted} onClick={toggleMute}>` with a `Volume2`/`VolumeX` lucide icon, styled to the design system (small pill, `focus-visible` ring). The click is the gesture that unlocks the context (the hook creates it inside `toggleMute`).
   - The hook already tracks `i` for crossfades; nothing else in `commit` changes.

4. **Run** (expect pass): `pnpm --filter web test SwipeDeck.ambient`.

5. **Full web suite + typecheck:** `pnpm --filter web test && pnpm typecheck`.

6. **Commit:** `git add apps/web/app/feed/SwipeDeck.tsx apps/web/app/feed/SwipeDeck.ambient.test.tsx && git commit -m "M4: wire useAmbientDeck + unmute pill into SwipeDeck"`

---

## Task 11 — Full verification + prod-apply plan

**Steps**

1. **Local green gate:** `pnpm db:reset && pnpm db:test && pnpm test && pnpm --filter web test && pnpm typecheck && pnpm lint`.
2. **Types fresh:** confirm `pnpm db:types` produced no further diff (`git status packages/types`).
3. **Manual smoke (local):** start the stack, post a night with a sound (and one without), open the feed, tap the unmute pill, swipe, confirm crossfade audibly; toggle OS reduced-motion and confirm hard-cut (still audible); reload and confirm the unmute choice persisted.
4. **Prod-apply (batched, reviewed):** review each migration against the live prod schema (drift checks above). Apply in order via `mcp__supabase__apply_migration` (or `supabase db push`): table → column → bucket → post_night → browse_feed → seed. Run `mcp__supabase__get_advisors(type=security)` after. Upload the real assets (Task 8 follow-up) and replace placeholder paths.
5. **Finish the branch** per `superpowers:finishing-a-development-branch`.

---

## Open questions / risks

- **Preview-in-picker base URL:** the picker builds preview URLs from `NEXT_PUBLIC_SUPABASE_URL`; confirm that env var is exposed to the web app (it is for the browser client). If assets aren't uploaded yet, previews 404 — acceptable during build, but flag for the asset follow-up.
- **`browse_feed_for_viewer` performance:** the `LATERAL` fallback runs a GIN-indexed `&&` per row; fine at feed page sizes (≤50). Confirm `ambient_sounds_vibe_gin` is used (it is small; planner may seq-scan — negligible).
- **Audio decode cost on mobile Safari:** decoding multiple 20s loops; the hook only decodes current+next, which bounds memory. Monitor.
