# M5 — `get_night_detail`: the swiper can finally see the date (blind-safe)

## Goal

Close the P0 core-promise gap from the date-generator-flow audit
(`docs/superpowers/reports/2026-06-01-date-generator-flow-audit.md` §4): the swiper
**cannot see the date** they are swiping on. The feed card and `NightDetailSheet` render
only the blind summary (cover, title, why-note, ≤4 vibe tags, hour-bucket, neighborhood,
distance). The rich itinerary — stops, venue names, types, times, cost, the "why", map
coords — never reaches the feed. `NightDetailSheet.tsx`'s own header comment says it is
blocked on an unbuilt `get_night_detail(p_instance)` RPC.

Build `get_night_detail(p_instance uuid)` (SECURITY DEFINER, granted to `authenticated`)
that returns the **full date detail in a blind-safe shape** — stops list, venue names,
types, times, per-stop cost, total cost, the story, map coords, photos — but with **NO host
identity** (no creator name/photo/socials, no `itinerary_id`, no `creator_id`). Wire
`NightDetailSheet` to fetch + render it so "swipe on the night, not the person" is finally
deliverable.

**Decision locked (per brief):** published dates are restricted to curated/vetted venues,
so itinerary detail (venue names, addresses, coords) is safe to show pre-swipe. The blind
contract protects the *host's identity*, not the *venue list*.

## Architecture

**Mirror the existing blind feed exactly.** `browse_feed_for_viewer`
(`supabase/migrations/20260527120300_s5_browse_feed.sql` →
`20260527120400_s5_browse_feed_drop_itinerary_id.sql`) is the canonical blind projection:
`security definer`, `set search_path = public, extensions`, `revoke execute … from public`,
`grant execute … to authenticated`, actor = `auth.uid()`. The `_drop_itinerary_id` migration
is the load-bearing precedent: `itinerary_id` was **removed** from the feed projection
because a client could join `itineraries.user_id` (world-readable) to de-anonymize the
creator. `get_night_detail` MUST honor the same rule — never return `itinerary_id`,
`creator_id`, or `venue_id` that lets a client reach back to the host.

**Why a new RPC, not a feed-projection widening:** the feed returns up to 50 rows; loading
full stop arrays for every card is wasteful and the swiper only needs detail for the card
they tap. `get_night_detail` is a single-instance fetch triggered on sheet-open.

**Eligibility gate = the feed's gate, re-applied.** `get_night_detail` is callable for any
authenticated viewer, but only returns a row when the instance is one the viewer is *allowed
to see in the feed*: `status='seeking'`, `starts_at > now()`, `moderation_status='approved'`,
creator active/verified/dating-enabled, and **not the viewer's own**. We do NOT re-run the
full mutual-compatibility/distance filter (the viewer already has the card in their deck from
`browse_feed_for_viewer`; re-deriving it per-tap is redundant and would reject curated seeds
the feed surfaced). We DO re-check the hard publication gates so a withdrawn/cancelled/
unapproved instance cannot be detail-fetched by guessing its UUID. This is a deliberate,
documented scope choice (mirrors how `match_offer_recipient_can_see_instance` re-checks state
live).

**Stop shape is heterogeneous.** Generated itineraries store rich stops
(`place_name`, `place_type`, `start_time`, `duration_min`, `estimated_cost_pp`, `what_to_do`,
`photo_url`, `neighborhood`, `lat`/`lng`, `local_insight`, `drive_to_next_min` — see
`supabase/functions/generate-plan/types.ts` `ItineraryStop` and `apps/web/lib/itinerary-types.ts`
`Stop`). The e2e seed and some legacy rows store a thin `{name, type}` shape
(`apps/web/e2e/_helpers/seed.ts:98`). The RPC reads `itineraries.stops` as raw `jsonb` and
returns it **as-is** (the SQL does not reshape jsonb); the api-client normalizes both shapes
into one `NightDetailStop` TS type so the UI renders defensively.

**Blind-safe field decision (cross-checked against the feed projection):**

| Field | Source | Exposed? | Why |
|---|---|---|---|
| `date_instance_id` | `di.id` | YES | already in feed |
| `title` | `it.title` | YES | already in feed |
| `why_note` / story | `it.why_note`, `it.why_it_works`, `it.hook` | YES | the "why"; `why_note` already in feed |
| `vibe_tags` | `it.vibe_tags` | YES | already in feed |
| `cover_image_url` | `it.cover_image_url` | YES | already in feed |
| `pay_setting` | `it.pay_setting` | YES | already in feed |
| `time_window_start` | `date_trunc('hour', di.starts_at)` | YES (coarse) | feed truncates to hour — keep coarse, never minute-precise |
| `venue_neighborhood` | `pl.neighborhood` | YES | already in feed |
| `distance_m` | `st_distance` | YES | already in feed |
| `is_seed` | `di.is_seed` | YES | already in feed |
| `total_cost_pp` | `it.total_cost_pp` | YES (NEW) | curated-venue cost is safe; core to "see the date" |
| `total_duration_min` | `it.total_duration_min` | YES (NEW) | safe logistics |
| `stops[]` (names, types, cost, story, coords, photos) | `it.stops` jsonb | YES (NEW) | the whole point; venues are curated/vetted |
| `itinerary_id` | — | **NO** | de-anonymization vector — dropped by `_drop_itinerary_id` precedent |
| `creator_id` | — | **NO** | host identity |
| host name / photo / `instagram_handle` / socials | — | **NO** | host identity (the blind contract) |
| `venue_id` | — | **NO** | re-joinable to host-adjacent data; coords/name carry the venue value instead |
| `di.starts_at` (raw minute) | — | **NO** | only the hour-truncated value leaves the RPC |
| per-stop `reservation_url` | `stops[].reservation_url` | **NO (pre-match)** | a host could embed a personal/identifying booking link; suppressed pre-match, shown post-lock by other surfaces |

**Tech Stack:** Postgres (Supabase) SQL `security definer` RPC; pgTAP for DB tests
(`supabase/tests/`); `packages/api-client` (TS wrapper + `NightDetailNight`/`NightDetailStop`
types); Next.js client component `NightDetailSheet.tsx` (vaul Drawer, framer-motion, Barbiecore
per `docs/superpowers/DESIGN-SYSTEM.md`); Playwright e2e (`apps/web/e2e/`). All copy follows the
stop-slop rules (lowercase, no em-dashes, no filler).

---

## PRE-FLIGHT — prod-schema-drift verification (BLOCKING, do BEFORE writing DDL)

Prod ref `ufufmcpnysvwtutpbian`. Local-vs-prod drift is a known hazard (memory:
`reference_supabase-prod-schema.md`). Verify these read-only on prod **before** writing the
migration, because the RPC's column list depends on them:

1. **`itineraries` columns exist on prod:** `stops`, `title`, `hook`, `why_it_works`,
   `why_note`, `vibe_tags`, `cover_image_url`, `pay_setting`, `total_cost_pp`,
   `total_duration_min`. (`why_note`/`vibe_tags`/`pay_setting`/`cover_image_url` are added by
   `20260525120300_p0_date_instances.sql`; `total_cost_pp`/`total_duration_min`/`hook`/
   `why_it_works`/`title`/`stops` by the initial schema.)
2. **`date_instances` columns exist on prod:** `id`, `itinerary_id`, `creator_id`, `city_id`,
   `venue_id`, `starts_at`, `status`, `moderation_status`, `is_seed`.
3. **`browse_feed_for_viewer` signature on prod** matches
   `(uuid, geography, timestamptz, uuid, int)` (so the grant/revoke pattern we copy is valid)
   and `get_night_detail` does **not already exist** on prod (avoid clobbering).
4. **`places.neighborhood` exists** (the feed left-joins it).
5. **`profiles` gate columns exist:** `account_state`, `standing`, `verification`,
   `dating_enabled` (the feed filters on them).

Run via the Supabase MCP (OAuth, read-only) — e.g. `mcp__supabase__list_tables` for
`itineraries`/`date_instances`/`places`/`profiles`, and `mcp__supabase__execute_sql`:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('browse_feed_for_viewer','get_night_detail');
```

**If any column is missing on prod, STOP and reconcile** before authoring the migration —
do not invent columns. Record findings in the RUN-LOG. This migration is **GATED** (not
auto-applied to prod): apply locally, run pgTAP green, then batch-apply to prod per the
secure-by-default workflow (run `mcp__supabase__get_advisors` after DDL).

---

## Task 1 — DB: `get_night_detail(p_instance uuid)` RPC (pgTAP TDD)

**Files**
- Create: `supabase/migrations/20260601210000_m5_get_night_detail.sql`
- Create: `supabase/tests/m5_get_night_detail_test.sql`

### Step 1.1 — Write the failing pgTAP test

Mirror the conventions in existing `supabase/tests/*` (pgTAP `plan()`, `set_config` to
impersonate a viewer via `request.jwt.claims`, `results_eq`/`is`/`ok`). Create
`supabase/tests/m5_get_night_detail_test.sql`:

```sql
begin;
select plan(11);

-- Fixtures: a city, two profiles (host verified+dating, viewer compatible),
-- an itinerary with rich stops, a seeking+approved date_instance.
insert into cities (id, name, slug, centroid)
  values ('11111111-1111-1111-1111-111111111111','Kelowna','kelowna',
          st_setsrid(st_makepoint(-119.496,49.888),4326)::geography)
  on conflict (id) do nothing;

insert into profiles (id, account_state, standing, verification, dating_enabled,
                      gender, gender_preferences, age, age_pref, distance_pref_km, primary_city_id)
  values
   ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','active','good','verified',true,
    'woman', array['man']::text[], 30, int4range(25,40), 50,
    '11111111-1111-1111-1111-111111111111'),
   ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','active','good','verified',true,
    'man', array['woman']::text[], 32, int4range(25,40), 50,
    '11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

insert into itineraries (id, user_id, inputs, stops, title, hook, why_it_works, why_note,
                         vibe_tags, cover_image_url, pay_setting, total_cost_pp, total_duration_min)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '{}'::jsonb,
          '[{"place_name":"The Train Station Pub","place_type":"cocktail_bar","start_time":"19:00",
             "duration_min":90,"estimated_cost_pp":28,"what_to_do":"split the charcuterie",
             "neighborhood":"Downtown","lat":49.888,"lng":-119.496,"photo_url":"https://x/p.jpg",
             "local_insight":"ask for the corner booth","reservation_url":"https://secret-host-link"}]'::jsonb,
          'late night downtown', 'a slow burn', 'walkable, low-key, real',
          'walkable and low-key', array['cozy','nightlife']::text[],
          'https://x/cover.jpg', 'go_dutch', 56, 180);

insert into date_instances (id, itinerary_id, creator_id, city_id, starts_at, duration_min,
                            status, moderation_status, is_seed)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
          'cccccccc-cccc-cccc-cccc-cccccccccccc',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          now() + interval '3 days', 180, 'seeking', 'approved', false);

-- Impersonate the VIEWER (the candidate), not the creator.
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
set local role authenticated;

-- 1. function exists with the expected signature
select has_function('public','get_night_detail', array['uuid'], 'get_night_detail(uuid) exists');

-- 2. returns exactly one row for a visible instance
select is(
  (select count(*) from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  1::bigint, 'returns one row for a seeking/approved instance');

-- 3-7. blind-safe fields are present and correct
select is((select title from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  'late night downtown', 'title surfaced');
select is((select total_cost_pp from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  56::numeric, 'total cost surfaced');
select is((select jsonb_array_length(stops) from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  1, 'stops array surfaced');
select is(
  (select stops->0->>'place_name' from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  'The Train Station Pub', 'venue name surfaced in stops');
select is(
  (select date_part('minute', time_window_start)::int
     from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  0, 'time is hour-truncated (no minute precision leaks)');

-- 8. NO host-identity / de-anon columns in the return type
select hasnt_column('public','get_night_detail_unused','noop') is null; -- placeholder removed below

-- 8 (real). reservation_url is scrubbed from stops (could be an identifying host link)
select is(
  (select stops->0->>'reservation_url' from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  null, 'reservation_url scrubbed from pre-match stops');

-- 9. an instance the viewer should NOT see (unapproved) returns zero rows
update date_instances set moderation_status='pending'
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd';
select is(
  (select count(*) from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  0::bigint, 'unapproved instance is not detail-readable');
update date_instances set moderation_status='approved'
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd';

-- 10. the viewer cannot detail-fetch their OWN instance via this RPC path
--     (feed excludes self; detail mirrors it). Impersonate the creator.
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is(
  (select count(*) from get_night_detail('dddddddd-dddd-dddd-dddd-dddddddddddd')),
  0::bigint, 'creator does not see own night via get_night_detail');

-- 11. the return type does NOT expose itinerary_id / creator_id / venue_id
select bag_eq(
  $$ select column_name from information_schema.routines r
       join information_schema.parameters pm on pm.specific_name = r.specific_name
      where r.routine_name='get_night_detail' and pm.parameter_mode='OUT'
        and pm.parameter_name in ('itinerary_id','creator_id','venue_id') $$,
  $$ values (null::text) $$,
  'no de-anonymization columns in the OUT signature') ;

select finish();
rollback;
```

> Note: the exact pgTAP assertion helpers (`has_function`, `is`, `bag_eq`) are already used in
> `supabase/tests`. Match whatever the repo's existing tests use; adjust helper names to the
> installed pgTAP version if `bag_eq`/`hasnt_column` differ. The placeholder line marked
> "removed below" is illustrative — delete it; the real assertion #11 below it stands.

### Step 1.2 — Run it (expect FAIL: function does not exist)

```bash
supabase test db
```

Expect failure on `has_function … get_night_detail(uuid) exists`.

### Step 1.3 — Minimal implementation (the migration)

Create `supabase/migrations/20260601210000_m5_get_night_detail.sql`:

```sql
-- supabase/migrations/20260601210000_m5_get_night_detail.sql
-- M5: blind-safe FULL date detail for the swiper. The swiper taps a feed card and
-- reads the real itinerary (stops, venues, cost, story, map) BEFORE deciding —
-- "swipe on the night, not the person."
--
-- BLIND CONTRACT (mirrors browse_feed_for_viewer + its _drop_itinerary_id fix):
--   * NO host identity: creator_id, itinerary_id, venue_id, host name/photo/socials
--     never appear in the return signature. itinerary_id is omitted for the SAME
--     reason 20260527120400 dropped it from the feed: it joins itineraries.user_id
--     (world-readable) to de-anonymize the creator.
--   * time is hour-truncated (never minute-precise), exactly like the feed.
--   * per-stop reservation_url is scrubbed (a host could embed an identifying link);
--     booking links are surfaced post-lock by other surfaces, not here.
--
-- ELIGIBILITY: returns a row only when the instance passes the feed's hard
-- publication gates (seeking, future, approved, creator active/verified/dating,
-- not self). It does NOT re-run the mutual-compatibility/distance filter — the
-- viewer already holds the card from the feed; re-deriving per-tap is redundant
-- and would reject curated seeds the feed surfaced. Guessing a UUID still cannot
-- read a withdrawn/unapproved/own instance.
--
-- DECISION LOCKED: published nights use curated/vetted venues, so venue names,
-- coords, and cost are safe to show pre-swipe. The contract protects the host's
-- IDENTITY, not the venue list.

create or replace function get_night_detail(p_instance uuid)
returns table (
  date_instance_id uuid,
  time_window_start timestamptz,
  pay_setting text,
  vibe_tags text[],
  why_note text,
  hook text,
  why_it_works text,
  cover_image_url text,
  title text,
  venue_neighborhood text,
  is_seed boolean,
  total_cost_pp numeric,
  total_duration_min int,
  stops jsonb
) language sql security definer set search_path = public, extensions as $fn$
  select
    di.id,
    date_trunc('hour', di.starts_at) as time_window_start,
    it.pay_setting::text,
    it.vibe_tags,
    it.why_note,
    it.hook,
    it.why_it_works,
    it.cover_image_url,
    it.title,
    pl.neighborhood,
    di.is_seed,
    it.total_cost_pp,
    it.total_duration_min,
    -- Scrub reservation_url from every stop (possible identifying host link).
    coalesce(
      (select jsonb_agg(s - 'reservation_url')
         from jsonb_array_elements(it.stops) as s),
      '[]'::jsonb
    ) as stops
  from date_instances di
  join profiles cr on cr.id = di.creator_id
  join itineraries it on it.id = di.itinerary_id
  left join places pl on pl.id = di.venue_id
  where di.id = p_instance
    and di.status = 'seeking'
    and di.starts_at > now()
    and di.moderation_status = 'approved'
    and cr.account_state = 'active'
    and cr.standing not in ('suspended','locked_ban')
    and cr.verification = 'verified'
    and cr.dating_enabled = true
    and di.creator_id <> auth.uid();
$fn$;

revoke execute on function get_night_detail(uuid) from public;
grant execute on function get_night_detail(uuid) to authenticated;
```

> If `it.stops` can be a non-array jsonb on legacy rows, `jsonb_array_elements` would error.
> If the PRE-FLIGHT prod check shows any non-array `stops`, guard with
> `case when jsonb_typeof(it.stops)='array' then (…) else '[]'::jsonb end`. Default to the
> guarded form to be safe; adjust the test fixture accordingly.

### Step 1.4 — Run it (expect PASS)

```bash
supabase test db
```

All 11 assertions green. If the `bag_eq` OUT-signature assertion is brittle on the installed
pgTAP, replace with `has_function`/`hasnt_*` equivalents that confirm the OUT params — the
intent is: prove `itinerary_id`/`creator_id`/`venue_id` are NOT in the signature.

### Step 1.5 — Security advisor + commit

```bash
# After local-green, before any prod apply, run the advisor (memory: secure-by-default-db).
# (Prod apply is a separate GATED step, not part of this commit.)
git add supabase/migrations/20260601210000_m5_get_night_detail.sql supabase/tests/m5_get_night_detail_test.sql
git commit -m "M5: get_night_detail blind-safe RPC + pgTAP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 — api-client: `getNightDetail` wrapper + types (TDD)

**Files**
- Modify: `packages/api-client/src/feed.ts`
- Modify: `packages/api-client/src/index.ts` (re-export)
- Modify: `apps/web/lib/after5/client.ts` (re-export for web)
- Create: `packages/api-client/src/feed.test.ts` (if a test runner exists for the package; else
  fold the normalization assertion into the web unit test in Task 4)

### Step 2.1 — Write the failing test (normalization is the load-bearing logic)

The RPC returns `stops` as raw jsonb whose element shape varies (rich generated vs thin
`{name,type}` seed). The wrapper must normalize to one `NightDetailStop`. Create
`packages/api-client/src/feed.test.ts` (vitest, matching repo convention):

```ts
import { describe, it, expect } from 'vitest';
import { normalizeNightDetailStops } from './feed';

describe('normalizeNightDetailStops', () => {
  it('maps rich generated stops', () => {
    const out = normalizeNightDetailStops([
      { place_name: 'The Pub', place_type: 'cocktail_bar', start_time: '19:00',
        duration_min: 90, estimated_cost_pp: 28, what_to_do: 'split the charcuterie',
        neighborhood: 'Downtown', lat: 49.888, lng: -119.496, photo_url: 'p.jpg',
        local_insight: 'corner booth' },
    ]);
    expect(out[0].name).toBe('The Pub');
    expect(out[0].type).toBe('cocktail_bar');
    expect(out[0].cost_pp).toBe(28);
    expect(out[0].lat).toBe(49.888);
  });

  it('maps thin {name,type} legacy/seed stops without crashing', () => {
    const out = normalizeNightDetailStops([{ name: 'E2E Stop 1', type: 'cocktail_bar' }]);
    expect(out[0].name).toBe('E2E Stop 1');
    expect(out[0].type).toBe('cocktail_bar');
    expect(out[0].cost_pp).toBeNull();
  });

  it('returns [] for null/garbage', () => {
    expect(normalizeNightDetailStops(null)).toEqual([]);
    expect(normalizeNightDetailStops('nope' as unknown as unknown[])).toEqual([]);
  });
});
```

### Step 2.2 — Run it (expect FAIL: export missing)

```bash
pnpm --filter @after5/api-client test
```

(If the package has no test script, add `"test": "vitest run"` to its `package.json` mirroring
`@after5/business`/`@after5/date-quality`; else run the equivalent the repo uses.)

### Step 2.3 — Implement wrapper + types in `packages/api-client/src/feed.ts`

Append to `packages/api-client/src/feed.ts`:

```ts
// ─── M5: blind-safe FULL date detail ─────────────────────────────────────────

/** One stop in a blind-safe night detail. Normalized from heterogeneous
 *  itineraries.stops jsonb (rich generated vs thin {name,type} legacy/seed). */
export interface NightDetailStop {
  name: string;
  type: string | null;
  start_time: string | null;
  duration_min: number | null;
  cost_pp: number | null;
  what_to_do: string | null;
  neighborhood: string | null;
  local_insight: string | null;
  photo_url: string | null;
  lat: number | null;
  lng: number | null;
  drive_to_next_min: number | null;
}

/** Full pre-swipe date detail. Carries NO host identity (no itinerary_id,
 *  creator_id, venue_id, or host name/photo) — mirrors the feed's blind contract. */
export interface NightDetailNight {
  date_instance_id: string;
  time_window_start: string;
  pay_setting: string | null;
  vibe_tags: string[] | null;
  why_note: string | null;
  hook: string | null;
  why_it_works: string | null;
  cover_image_url: string | null;
  title: string | null;
  venue_neighborhood: string | null;
  is_seed: boolean;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: NightDetailStop[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function normalizeNightDetailStops(raw: unknown): NightDetailStop[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      // rich shape uses place_name/place_type; thin seed shape uses name/type.
      name: str(o.place_name) ?? str(o.name) ?? 'a spot',
      type: str(o.place_type) ?? str(o.type),
      start_time: str(o.start_time),
      duration_min: num(o.duration_min),
      cost_pp: num(o.estimated_cost_pp),
      what_to_do: str(o.what_to_do),
      neighborhood: str(o.neighborhood),
      local_insight: str(o.local_insight),
      photo_url: str(o.photo_url),
      lat: num(o.lat),
      lng: num(o.lng),
      drive_to_next_min: num(o.drive_to_next_min),
    };
  });
}

export async function getNightDetail(
  client: After5Client,
  instanceId: string,
): Promise<NightDetailNight | null> {
  const { data, error } = await client.rpc('get_night_detail', { p_instance: instanceId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    date_instance_id: r.date_instance_id as string,
    time_window_start: r.time_window_start as string,
    pay_setting: str(r.pay_setting),
    vibe_tags: Array.isArray(r.vibe_tags) ? (r.vibe_tags as string[]) : null,
    why_note: str(r.why_note),
    hook: str(r.hook),
    why_it_works: str(r.why_it_works),
    cover_image_url: str(r.cover_image_url),
    title: str(r.title),
    venue_neighborhood: str(r.venue_neighborhood),
    is_seed: r.is_seed === true,
    total_cost_pp: num(r.total_cost_pp),
    total_duration_min: num(r.total_duration_min),
    stops: normalizeNightDetailStops(r.stops),
  };
}
```

### Step 2.4 — Re-export

In `packages/api-client/src/index.ts`, extend the feed re-export line (currently line 70):

```ts
export {
  postNight, browseFeed, recordSwipe, getNightDetail,
  type FeedNight, type NightDetailNight, type NightDetailStop,
} from './feed';
```

In `apps/web/lib/after5/client.ts`, extend the matching re-export:

```ts
export {
  postNight, browseFeed, recordSwipe, getNightDetail,
  type FeedNight, type NightDetailNight, type NightDetailStop,
} from '@after5/api-client';
```

### Step 2.5 — Run + typecheck + commit

```bash
pnpm --filter @after5/api-client test
pnpm --filter @after5/api-client typecheck   # or: pnpm -w typecheck
git add packages/api-client/src/feed.ts packages/api-client/src/feed.test.ts \
        packages/api-client/src/index.ts apps/web/lib/after5/client.ts
git commit -m "M5: getNightDetail api-client wrapper + blind-safe types + stop normalization

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 — UI: wire `NightDetailSheet` to fetch + render real detail (Barbiecore)

**Files**
- Modify: `apps/web/app/feed/NightDetailSheet.tsx`
- Modify: `apps/web/app/feed/SwipeDeck.tsx` (sheet already receives the active `night`; no prop
  change needed — the sheet fetches detail itself on open, keyed by `night.date_instance_id`)

### Behaviour

On sheet open, fetch `getNightDetail(date_instance_id)`. While loading, render the existing
blind summary (title, why-note, vibe tags, time/neighborhood/pay) as a skeleton-free
fallback so the sheet is never blank. When detail arrives, render the **stops timeline**
(blind-safe StopCard variant), the **total cost**, the **story** (`why_it_works`/`hook` if
present, else `why_note`), and a **map** (static-image or list of coords — reuse pieces from
`apps/web/components/itinerary/ItineraryMap.tsx` if it accepts plain coords; otherwise render a
"directions" link per stop like `StopCard` does, NOT a host-revealing embed). Keep the blind
reassurance line and the swipe-action footer exactly as they are.

The sheet stays blind: it renders **only** `NightDetailNight` fields. There is no host name,
photo, or `reservation_url` (the RPC already scrubbed it).

### Step 3.1 — Add a fetch hook inside `NightDetailSheet`

The component currently takes `night: FeedNight | null`. Keep that for the instant fallback,
and add an internal fetch keyed by the instance id, only when `open`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import {
  browserAfter5Client, getNightDetail,
  type FeedNight, type NightDetailNight, type NightDetailStop,
} from '@/lib/after5/client';
// …existing imports (Image, Drawer, lucide icons, vibePalette, stickerRotation, LocalTime, cn)…
```

Inside the component, before the early `if (!night) return null;`:

```tsx
const [detail, setDetail] = useState<NightDetailNight | null>(null);
const [loading, setLoading] = useState(false);

useEffect(() => {
  if (!open || !night) return;
  let cancelled = false;
  setDetail(null);
  setLoading(true);
  getNightDetail(browserAfter5Client(), night.date_instance_id)
    .then((d) => { if (!cancelled) setDetail(d); })
    .catch(() => { if (!cancelled) setDetail(null); }) // fall back to blind summary
    .finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, [open, night?.date_instance_id]);
```

### Step 3.2 — Render the stops, cost, story, map

Replace the "the plan" `<dl>` block (lines ~139-182 of the current file) so that:
- the time/neighborhood/pay summary stays (always available from `night`),
- **below it**, when `detail` exists, render the story, total cost, and stops list.

Add a blind-safe inline stop renderer (do NOT reuse the public `StopCard` directly — it links
to `/places/[slug]` and assumes Kelowna and full desktop layout; keep the sheet self-contained
and on-palette). Insert after the existing summary `<dl>`:

```tsx
{detail && (
  <>
    {(detail.why_it_works || detail.hook) && (
      <div>
        <p className="mb-1 font-body text-xs lowercase tracking-[0.14em] opacity-60">the story</p>
        <p className="font-body text-[16px] leading-relaxed opacity-90">
          {(detail.why_it_works ?? detail.hook ?? '').toLowerCase()}
        </p>
      </div>
    )}

    {detail.stops.length > 0 && (
      <div>
        <p className="mb-2 font-body text-xs lowercase tracking-[0.14em] opacity-60">the night</p>
        <ol className="flex flex-col gap-3">
          {detail.stops.map((s, idx) => (
            <StopRow key={`${s.name}-${idx}`} stop={s} index={idx} accent={pal.accent} bg={pal.bg} />
          ))}
        </ol>
      </div>
    )}

    {detail.total_cost_pp != null && detail.total_cost_pp > 0 && (
      <div className="flex items-center gap-2.5 font-body text-[15px] opacity-90">
        <Wallet className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        <span>around ${Math.round(detail.total_cost_pp)} each</span>
      </div>
    )}
  </>
)}
```

Add the `StopRow` sub-component at the bottom of the file (blind-safe — name, type,
what_to_do, cost, local insight, photo, optional directions link via name query; NO slug
link, NO reservation_url):

```tsx
function StopRow({
  stop, index, accent, bg,
}: { stop: NightDetailStop; index: number; accent: string; bg: string }) {
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
  return (
    <li className="flex gap-3 rounded-2xl bg-current/5 p-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-heading text-sm"
        style={{ background: accent, color: bg }}
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-lg lowercase leading-tight">{stop.name.toLowerCase()}</p>
        {(stop.neighborhood || stop.type) && (
          <p className="mt-0.5 font-body text-xs lowercase tracking-[0.1em] opacity-55">
            {[stop.neighborhood, stop.type?.replace(/_/g, ' ')].filter(Boolean).join(' · ').toLowerCase()}
          </p>
        )}
        {stop.what_to_do && (
          <p className="mt-2 font-body text-[14px] leading-relaxed opacity-85">{stop.what_to_do}</p>
        )}
        {stop.local_insight && (
          <p className="mt-2 font-body text-[13px] leading-relaxed opacity-70">
            tip: {stop.local_insight}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs opacity-70">
          {stop.cost_pp != null && <span>{stop.cost_pp > 0 ? `$${Math.round(stop.cost_pp)} pp` : 'free'}</span>}
          {(stop.lat != null || stop.name) && (
            <a href={directions} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 underline decoration-2 underline-offset-2">
              <MapPin className="h-3 w-3" aria-hidden /> map
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
```

> **Map decision:** a per-stop "map" directions link (same pattern `StopCard` already uses,
> name-query into Google Maps) is the blind-safe map. A static map image rendering all stop
> coords is acceptable too if `ItineraryMap` can take plain `{lat,lng}[]` — but it must not
> render any host marker. Default to the per-stop link to avoid a Google Maps Static API key
> dependency and keep the sheet self-contained.

### Step 3.3 — Update the sheet header comment

Update the file-top comment to reflect that the `get_night_detail` RPC now exists and the
sheet renders the full blind-safe detail (the comment currently says detail is blocked on an
unbuilt RPC — that is now false).

### Step 3.4 — Typecheck + lint + commit

```bash
pnpm --filter @after5/web typecheck
pnpm --filter @after5/web lint
git add apps/web/app/feed/NightDetailSheet.tsx
git commit -m "M5: render full blind-safe date detail in NightDetailSheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 — E2E: extend the feed test (real detail renders, no identity leaks)

**Files**
- Modify: `apps/web/e2e/_helpers/seed.ts` (enrich the seeded itinerary with a rich stop +
  cost + story so there is real detail to assert; keep it backward-compatible with existing
  5b tests, which only assert the feed card)
- Create: `apps/web/e2e/m5-night-detail.spec.ts`

### Step 4.1 — Enrich the seed (additive — existing 5b tests still pass)

In `apps/web/e2e/_helpers/seed.ts`, change the itinerary insert (line ~95) to carry a rich
stop, total cost, and story while keeping `vibe_tags`/`title`. Use a recognizable venue name
and an identifying-looking `reservation_url` so the leak assertion is meaningful:

```ts
.insert({
  user_id: hostId,
  inputs: { e2e: true, neighborhood: 'Downtown Kelowna' },
  stops: [{
    place_name: 'The Train Station Pub', place_type: 'cocktail_bar', start_time: '19:00',
    duration_min: 90, estimated_cost_pp: 28, what_to_do: 'split the charcuterie',
    neighborhood: 'Downtown', lat: 49.888, lng: -119.496,
    local_insight: 'ask for the corner booth',
    reservation_url: 'https://instagram.com/the-secret-host',
  }],
  title: `E2E night ${runId}`,
  hook: 'a slow burn',
  why_it_works: 'walkable, low-key, and actually fun',
  why_note: 'walkable and low-key',
  total_cost_pp: 56,
  total_duration_min: 180,
  cover_image_url: null,
  pay_setting: 'go_dutch',
  city_id: cityId,
  is_public: false,
  vibe_tags: ['cozy', 'creative'],
})
```

### Step 4.2 — Write the e2e spec

Create `apps/web/e2e/m5-night-detail.spec.ts`, mirroring `5b-happy-path.spec.ts` setup
(`seedTwoUsersAndNight`, `loginAs`, `cleanup`):

```ts
import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

let seed: SeedResult;
test.beforeAll(async () => { seed = await seedTwoUsersAndNight(); });
test.afterAll(async () => { if (seed) await cleanup(seed); });

test('M5: tapping a feed card opens the full blind-safe detail', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await loginAs(ctx, seed.candEmail);

  await page.goto('/feed');
  // The active card is a button (tap-to-read). Open the detail sheet.
  const card = page.getByRole('button', { name: /tap to read the full plan/i });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  // Real itinerary detail renders inside the sheet.
  await expect(page.getByText(/the train station pub/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/split the charcuterie/i)).toBeVisible();
  await expect(page.getByText(/the story/i)).toBeVisible();
  await expect(page.getByText(/walkable, low-key/i)).toBeVisible();
  await expect(page.getByText(/around \$56 each/i)).toBeVisible();

  // BLIND CONTRACT: no host identity / de-anon link leaks into the DOM.
  await expect(page.getByText(/the-secret-host/i)).toHaveCount(0);  // reservation_url scrubbed
  const html = await page.content();
  expect(html).not.toContain('instagram.com/the-secret-host');
  expect(html).not.toContain(seed.hostId);          // creator id never shipped
  // (host display name also absent — seed has no public host name on this surface)

  // Can swipe from inside the sheet.
  await page.getByRole('button', { name: /interested/i }).last().click();

  await ctx.close();
});
```

> Verify the exact `loginAs`/`seed` field names (`candEmail`, `hostId`) against
> `apps/web/e2e/_helpers/{auth,seed}.ts` before running — `5b-happy-path.spec.ts` uses
> `seed.candEmail`, `seed.hostEmail`, `seed.instanceId`, `seed.hostId`, so these are correct.

### Step 4.3 — Run the e2e (local stack)

Follow the repo's e2e runbook (the same one `5b-happy-path` uses):

```bash
supabase start
pnpm --filter @after5/web build && pnpm --filter @after5/web start &   # or dev server per repo convention
pnpm --filter @after5/web exec playwright test e2e/m5-night-detail.spec.ts
pnpm --filter @after5/web exec playwright test e2e/5b-happy-path.spec.ts  # regression: still green
```

Expect: M5 spec green (real detail visible, no leaks) and 5b still green (seed enrichment was
additive).

### Step 4.4 — Commit

```bash
git add apps/web/e2e/m5-night-detail.spec.ts apps/web/e2e/_helpers/seed.ts
git commit -m "M5: e2e — detail sheet renders real stops/cost/story, asserts no identity leak

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5 — GATED prod apply + verification

**Not part of the feature commits.** After all tasks are local-green:

1. Re-run PRE-FLIGHT prod checks (Task 0) to confirm no drift since.
2. Apply `20260601210000_m5_get_night_detail.sql` to prod via `mcp__supabase__apply_migration`
   (batched per the secure-by-default workflow; review the live migration list first).
3. Run `mcp__supabase__get_advisors` (security + performance) — expect no new findings on
   `get_night_detail` (it is `security definer` with pinned `search_path`, `revoke from public`,
   `grant to authenticated` — same posture as `browse_feed_for_viewer`).
4. Smoke on prod with an authed QA account (memory: `reference_local-qa-browser-login.md`):
   open `/feed`, tap a card, confirm stops/cost/story render and no host identity appears.
5. Deploy web (Vercel) so the wired `NightDetailSheet` ships with the new RPC.

---

## Verification checklist (definition of done)

- [ ] `supabase test db` green — `get_night_detail` exists, returns blind-safe fields, scrubs
      `reservation_url`, hour-truncates time, rejects unapproved/own instances, exposes no
      `itinerary_id`/`creator_id`/`venue_id`.
- [ ] `pnpm --filter @after5/api-client test` green — stop normalization handles rich + thin +
      garbage shapes.
- [ ] `pnpm --filter @after5/web typecheck && lint` green.
- [ ] `playwright test e2e/m5-night-detail.spec.ts` green — real stops/venues/cost/story render;
      `instagram.com/the-secret-host` and `hostId` absent from DOM.
- [ ] `playwright test e2e/5b-happy-path.spec.ts` still green (seed enrichment additive).
- [ ] Supabase security advisor clean on prod after gated apply.
- [ ] `NightDetailSheet.tsx` top comment updated (no longer "blocked on unbuilt RPC").
