# M1 — Generation seam + on-the-fly stopgap (Railway-pluggable)

**Date:** 2026-06-01
**Source spec:** `docs/superpowers/reports/2026-06-01-date-experience-milestone-plan.md` (M1 workstream)
**Owner of this plan:** backend (edge function + migrations)
**Worktree:** isolate (`superpowers:using-git-worktrees`); branch `m1-generation-seam`.

---

## Goal

Insert a `DateGenerationProvider` seam at the `generate-plan` edge function boundary so the current Kelowna pipeline becomes one swappable provider, an `OnTheFlyProvider` can warm an unwarmed city's `places` cache from Google and then reuse the *exact same* pipeline, and a `RailwayProvider` HTTP stub is ready to drop in when the owner's separate generation engine ships. The frontend → `generate-plan` contract stays **frozen**: request body is the existing Zod input (plus an optional `city_slug`), response is `{ itineraries, generated_at }`.

**Build philosophy (from the spec): UNDER-build ingestion, OVER-invest in the interface.** The on-the-fly path is a deliberately thin cache-warmer (no per-place LLM augment), because the real generation engine is coming. The seam, selection, and persistence contract are the durable assets.

**Locked product decision:** the DATING publish path (real-world meetups) stays restricted to curated `approval_status='live'` venues. `'auto'` (and `'discovered'`/`'warmed'`) venues are usable for **solo planning + the landing** but **blocked from becoming a dating meetup** until vetted. This plan enforces that in `post_night`.

---

## Architecture

```
frontend (apps/web/app/plan/page.tsx)
   │  supabase.functions.invoke('generate-plan', { body: Inputs + city_slug? })
   ▼
generate-plan/index.ts  (handler: CORS, Zod validate, rate-limit, auth — UNCHANGED responsibilities)
   │  resolve city (city_slug → cities row)  ───────────────┐
   │  selectProvider(citySlug, supabase) reads feature_config│ "generation_providers" map
   ▼                                                          ▼
DateGenerationProvider.generate({ inputs, city, supabase, env })  → Itinerary[]
   ├── KelownaProvider     (the entire current pipeline, extracted verbatim, city-scoped)
   ├── OnTheFlyProvider    (warm cache: Google Text Search → mappers → upsert places(source='discovered',
   │                        approval_status='auto', city_id) → then delegate to the shared pipeline scoped to city)
   └── RailwayProvider     (POST RAILWAY_GENERATOR_URL { inputs, city } → Itinerary[]; STUB, not selected yet)
   │
   ▼
persist.ts  (the existing insert+slug+modifier+near-twin+quality block, extracted; all providers persist identically)
   ▼
{ itineraries: withIds, generated_at }   ← FROZEN response shape
```

**Seam boundary is `Itinerary[]`** (the in-memory shape from `types.ts`), *before* persistence. Persistence is shared and lives outside the provider so a future Railway engine never has to learn our DB schema — it returns `Itinerary[]` and the handler persists.

**The pipeline is the shared asset.** `KelownaProvider` and `OnTheFlyProvider` both call one internal `runPipeline(...)` that wraps the steps currently inlined in `index.ts` (filterPlaces → templates → taste → buildWithRetry → delighter → sequence/adjacency fixers → modifiers → writeItineraries → photo scrub). The *only* difference: `OnTheFlyProvider` warms the cache first, and the pipeline is given a `city` so `filterPlaces` and the LLM prompt are no longer Kelowna-hardcoded.

### Why a separate `runPipeline`, not "KelownaProvider IS the pipeline"
The on-the-fly provider must reuse the templates/scoring/LLM machinery against freshly-warmed places. If that machinery lived only inside `KelownaProvider`, on-the-fly would have to either subclass or duplicate it. Extracting `runPipeline(ctx)` once and having both providers call it is the minimal, non-duplicating shape.

---

## Tech Stack

- **Edge runtime:** Deno (Supabase Edge Functions). Imports via URL / `npm:` / `https://esm.sh` — no workspace resolution.
- **Tests:** `deno test` with the existing stub import map at `supabase/functions/_shared/_test_import_map.json` (maps the supabase-js URL → `_test_supabase_stub.ts`). Provider/mapper unit tests are **pure-function** tests (the stub only models `.auth`/`.rpc`, NOT `.from()` chains — see Constraint C2 below).
- **External APIs:** Google Places v1 `places:searchText` (field-mask, port from `scripts/discover-places.mjs`); Anthropic (already wired in `prompt.ts`).
- **DB:** Postgres + PostGIS (already enabled). `cities` table + Kelowna row already exist.
- **Selection config:** `feature_config` table (already exists; `key text pk, value jsonb`).

---

## Verified current-state facts (read from the code, 2026-06-01)

- `generate-plan/index.ts` inlines the whole pipeline in `serve()`. Steps 3–8 are the pipeline; persistence is steps 8 (insert/slug/modifier/near-twin/quality). Response = `{ itineraries: withIds, generated_at }` at line ~583.
- `places-filter.ts` hardcodes `KELOWNA_LAT=49.888 / KELOWNA_LNG=-119.496` and filters `approval_status = 'live'`, `is_active = true`. No `city_id` filter exists.
- `prompt.ts` hardcodes "Kelowna" and "Okanagan" in `SYSTEM_PROMPT` (lines 8, 22) and the user message ("This is for couples in Kelowna"). City/region must be threaded in.
- `discover-places.mjs` holds the pure mappers to port: `mapGoogleTypes`, `priceLevelToTier`, `neighborhoodFromLatLng`, `driveClusterFromNeighborhood`, `slugify`, `pickHours`, plus `googleSearchText` (fetch + field-mask) and `buildPhotoUrl`. It also does a per-place LLM augment — **we deliberately drop that** for the stopgap.
- `places` table (`20260419193959_initial_schema.sql`): no `city_id`, no `source`. `lat/lng` are `decimal(9,6)`. `approval_status` enum `place_approval_status` = `('draft','live','rejected')` defined in `20260522100000_capture_full_schema.sql` (default `'live'`). `google_place_id`, `discovered_at`, `source_query` columns exist (added by discover-places usage / drift capture — verify on prod, see DDL gate).
- `cities` (`20260525120000_p0_extensions_and_cities.sql`): `centroid geography(Point,4326)`, `default_radius_km int`, `timezone`, `region`, `is_active`. Kelowna seeded. **No `centroid_lat/centroid_lng` scalar columns** — `filterPlaces` needs scalars (it does in-memory haversine, not PostGIS), so we add them and backfill from `centroid`.
- `feature_config` (`20260525123800_p2_feature_config.sql`): RLS on; service-role/admin write only; **no broad read policy**. The edge fn uses the service-role client (`SUPABASE_SERVICE_ROLE_KEY`) so it bypasses RLS — selection reads are fine.
- `date_instances.venue_id references places(id)` (`20260525120300`). `post_night` RPC (`20260527120200_s5_post_night.sql`) accepts `p_venue uuid` and inserts it as `venue_id` **without checking the venue's `approval_status`** — this is the publish-path hole to close.
- Deno tests run via `supabase/tests/_all_5b.sh` step 4, scoped to `match-*/ _shared/`. We must **add `generate-plan/` to that glob** (and there is a mirror invocation in `.github/workflows/5b-tests.yml` indirectly via `_all_5b.sh`, so editing the script is enough).

---

## Constraints & gotchas (read before writing code)

- **C1 — Frozen contract.** Do not change response keys (`itineraries`, `generated_at`) or remove any existing request field. `city_slug` is **additive + optional, default `'kelowna'`**. A request with no `city_slug` must behave byte-for-byte as today.
- **C2 — The supabase stub can't do `.from()`.** `_test_supabase_stub.ts` only models `.auth.getUser()` and `.rpc()`. Do **not** try to unit-test DB queries through it. Test the **pure** logic: mappers, `selectProvider`'s parsing of a `feature_config` value object, the Google response → `places`-row mapping, prompt city-threading. Where a provider needs DB I/O, inject it behind a small typed function param so the pure core is tested directly. (If a richer `.from()` stub is wanted later, that's its own task — out of scope here.)
- **C3 — Non-transactional enum add.** `ALTER TYPE place_approval_status ADD VALUE 'auto'` cannot run inside a transaction with subsequent uses of the new value, and Supabase migrations run in a transaction. Put the `ADD VALUE` in **its own migration file with NO other statements** so the value is committed before any later migration references `'auto'`. Use `ADD VALUE IF NOT EXISTS`.
- **C4 — Service-role client bypasses RLS.** The edge fn already builds the service-role client; provider DB writes (warm-cache upserts) inherit that. Do not add per-row RLS assumptions in provider code.
- **C5 — No new secret has ever been read by this edge fn for Google.** `GOOGLE_PLACES_API_KEY` + `RAILWAY_GENERATOR_URL` (+ optional `RAILWAY_API_TOKEN`) must be provisioned as Supabase **edge secrets** before the on-the-fly / railway paths can run on prod. Flag in deploy steps; the function must degrade gracefully (clear 5xx with a typed error) when the key is absent rather than throwing an opaque stack.
- **C6 — Google cost & latency.** On-the-fly does ~5–8 Text Search calls (categories: cafe, restaurant, bar, activity, park), **parallelized** (`Promise.allSettled`). No Place Details calls, no per-place LLM. Quality floor applied in-memory: `rating >= 4.0`, `userRatingCount >= 20`, `businessStatus === 'OPERATIONAL'`.
- **C7 — Idempotent warming.** Upsert on `google_place_id` (dedupe across categories + across repeated runs). A second generation for the same city must not duplicate rows.
- **C8 — DDL prod-drift gate.** Before applying ANY migration to prod (`ufufmcpnysvwtutpbian`), verify live `places`/`cities`/`feature_config` columns with the Supabase MCP read-only (`list_tables` / `execute_sql` `select`), per the schema-rigor and secure-by-default memory. Confirm whether `google_place_id` / `discovered_at` / `source_query` already exist on prod `places` (drift capture suggests yes) so the new migrations don't collide. Run `get_advisors` after DDL.

---

## Files

**Create**
- `supabase/functions/generate-plan/providers/types.ts` — `DateGenerationProvider`, `GenerationContext`, `CityRecord`.
- `supabase/functions/generate-plan/providers/pipeline.ts` — `runPipeline(ctx): Promise<Itinerary[]>` (the extracted shared pipeline).
- `supabase/functions/generate-plan/providers/kelowna.ts` — `KelownaProvider`.
- `supabase/functions/generate-plan/providers/onthefly.ts` — `OnTheFlyProvider` + `warmCity(...)`.
- `supabase/functions/generate-plan/providers/railway.ts` — `RailwayProvider` (stub).
- `supabase/functions/generate-plan/providers/select.ts` — `selectProvider(...)` + `parseProviderMap(...)`.
- `supabase/functions/generate-plan/google-places.ts` — ported pure mappers + `searchText` fetch + `googleResultToPlaceRow`.
- `supabase/functions/generate-plan/persist.ts` — extracted persistence (insert/slug/modifier/near-twin/quality).
- `supabase/functions/generate-plan/google-places.test.ts` — Deno tests for mappers + mapping.
- `supabase/functions/generate-plan/providers/select.test.ts` — Deno tests for provider-map parsing/selection.
- `supabase/functions/generate-plan/providers/onthefly.test.ts` — Deno tests for the pure warm-result→rows mapping + quality floor.
- `supabase/migrations/20260601210000_m1_places_city_source.sql`
- `supabase/migrations/20260601210100_m1_approval_status_auto.sql` (enum ADD VALUE only — C3)
- `supabase/migrations/20260601210200_m1_cities_centroid_scalars.sql`
- `supabase/migrations/20260601210300_m1_feature_config_providers.sql`
- `supabase/migrations/20260601210400_m1_post_night_curated_venue.sql`

**Modify**
- `supabase/functions/generate-plan/index.ts` — slim `serve()` down to: validate → auth → rate-limit → resolve city → `selectProvider` → `provider.generate()` → `persist()` → respond. Add `city_slug` to `InputSchema`.
- `supabase/functions/generate-plan/places-filter.ts` — accept a `city` (centroid + radius) instead of hardcoded Kelowna constants; filter `approval_status IN ('live','auto')` AND `city_id = city.id` (see Task 6 note on the `'auto'` inclusion).
- `supabase/functions/generate-plan/prompt.ts` — thread `cityName`/`region` into `SYSTEM_PROMPT` + user message (de-Kelowna-lock).
- `supabase/functions/generate-plan/types.ts` — add `city_slug?` to `PlanInputs`; add `CityRecord` re-export if convenient.
- `apps/web/app/plan/page.tsx` — add `city_slug` (default `'kelowna'`) to `Inputs` + thread into the invoke `body`.
- `supabase/tests/_all_5b.sh` — add `supabase/functions/generate-plan/` to the `deno test` glob (step 4).

---

## TDD task sequence

Each task: write failing test → run (see it fail) → minimal impl → run (green) → commit. Use `superpowers:test-driven-development`. Real commands below.

**Deno test command (run from repo root):**
```bash
deno test --allow-env --allow-net \
  --import-map=supabase/functions/_shared/_test_import_map.json \
  supabase/functions/generate-plan/
```

---

### Task 1 — Port the Google Places mappers to Deno (pure functions)

**Files:** Create `supabase/functions/generate-plan/google-places.ts`, `supabase/functions/generate-plan/google-places.test.ts`.

**Step 1.1 — failing test.** Create `google-places.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  mapGoogleTypes,
  priceLevelToTier,
  slugify,
  pickHours,
  passesQualityFloor,
  googleResultToPlaceRow,
} from './google-places.ts';

Deno.test('mapGoogleTypes: first-match-wins, falls back to activity', () => {
  assertEquals(mapGoogleTypes(['winery', 'restaurant']), 'winery');
  assertEquals(mapGoogleTypes(['cafe']), 'cafe');
  assertEquals(mapGoogleTypes(['bar', 'night_club']), 'cocktail_bar');
  assertEquals(mapGoogleTypes(['museum']), 'activity');
  assertEquals(mapGoogleTypes([]), 'activity');
});

Deno.test('priceLevelToTier maps Google enum strings', () => {
  assertEquals(priceLevelToTier('PRICE_LEVEL_FREE'), '$');
  assertEquals(priceLevelToTier('PRICE_LEVEL_MODERATE'), '$$');
  assertEquals(priceLevelToTier('PRICE_LEVEL_VERY_EXPENSIVE'), '$$$');
  assertEquals(priceLevelToTier(undefined), '$$');
});

Deno.test('slugify lowercases, strips accents/punct, trims dashes', () => {
  assertEquals(slugify('Café Médina!'), 'cafe-medina');
});

Deno.test('pickHours parses a weekday description range', () => {
  const h = pickHours({ weekdayDescriptions: ['Wednesday: 11:00 AM – 10:00 PM'] });
  assertEquals(h, { opens: '11:00', closes: '22:00' });
});

Deno.test('passesQualityFloor enforces rating>=4, reviews>=20, OPERATIONAL', () => {
  const base = { rating: 4.5, userRatingCount: 30, businessStatus: 'OPERATIONAL' };
  assertEquals(passesQualityFloor(base), true);
  assertEquals(passesQualityFloor({ ...base, rating: 3.9 }), false);
  assertEquals(passesQualityFloor({ ...base, userRatingCount: 19 }), false);
  assertEquals(passesQualityFloor({ ...base, businessStatus: 'CLOSED_PERMANENTLY' }), false);
});

Deno.test('googleResultToPlaceRow maps a result into a places row scoped to a city', () => {
  const row = googleResultToPlaceRow(
    {
      id: 'g123',
      displayName: { text: 'The Test Cafe' },
      formattedAddress: '1 Main St',
      location: { latitude: 49.88, longitude: -119.49 },
      types: ['cafe'],
      priceLevel: 'PRICE_LEVEL_MODERATE',
      rating: 4.4,
      userRatingCount: 51,
      businessStatus: 'OPERATIONAL',
      photos: [{ name: 'places/g123/photos/abc' }],
      regularOpeningHours: { weekdayDescriptions: ['Wednesday: 8:00 AM – 4:00 PM'] },
      websiteUri: 'https://x.test',
    },
    { id: 'city-uuid', slug: 'vernon' },
    'GKEY',
  );
  assertEquals(row.google_place_id, 'g123');
  assertEquals(row.type, 'cafe');
  assertEquals(row.price_tier, '$$');
  assertEquals(row.city_id, 'city-uuid');
  assertEquals(row.source, 'discovered');
  assertEquals(row.approval_status, 'auto');
  assertEquals(row.is_active, true);
  assertEquals(row.opens, '08:00');
  assertEquals(row.lat, 49.88);
  assertEquals(typeof row.photo_url, 'string');
  assertEquals(row.slug.startsWith('the-test-cafe-'), true); // suffixed with id tail
});
```

**Step 1.2 — run, confirm red.** `deno test ... supabase/functions/generate-plan/google-places.test.ts`.

**Step 1.3 — minimal impl.** Create `google-places.ts`. Port `mapGoogleTypes`, `priceLevelToTier`, `neighborhoodFromLatLng`, `driveClusterFromNeighborhood`, `slugify`, `pickHours`, `buildPhotoUrl` **verbatim** from `discover-places.mjs` (convert to TS, add types). Add:

```ts
export interface GoogleResult {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  priceLevel?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  photos?: { name: string }[];
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  websiteUri?: string;
}

export function passesQualityFloor(r: { rating?: number; userRatingCount?: number; businessStatus?: string }): boolean {
  return (r.rating ?? 0) >= 4.0
    && (r.userRatingCount ?? 0) >= 20
    && r.businessStatus === 'OPERATIONAL';
}

export interface CityForMapping { id: string; slug: string; }

export function googleResultToPlaceRow(r: GoogleResult, city: CityForMapping, googleKey: string) {
  const lat = r.location?.latitude ?? null;
  const lng = r.location?.longitude ?? null;
  const neighborhood = neighborhoodFromLatLng(lat, lng);
  const type = mapGoogleTypes(r.types ?? []);
  const photoResource = r.photos?.[0]?.name;
  const hours = pickHours(r.regularOpeningHours ?? null);
  const name = r.displayName?.text ?? 'Unknown';
  return {
    name,
    slug: `${slugify(name || r.id)}-${r.id.slice(-6).toLowerCase()}`,
    address: r.formattedAddress ?? null,
    neighborhood,
    drive_cluster: driveClusterFromNeighborhood(neighborhood),
    type,
    // No per-place LLM augment in the stopgap — neutral defaults.
    vibe_tags: [] as string[],
    pairing_tags: [] as string[],
    effort: 'low',
    energy: 'medium',
    time_of_day: [] as string[],
    weather_dependent: false,
    seasonality: ['year_round'],
    typical_duration_min: 60,
    opens: hours.opens,
    closes: hours.closes,
    price_tier: priceLevelToTier(r.priceLevel),
    typical_per_person: null as number | null,
    reservation_required: false,
    reservation_url: r.websiteUri ?? null,
    photo_url: photoResource ? buildPhotoUrl(photoResource, googleKey) : null,
    google_place_id: r.id,
    lat,
    lng,
    quality_score: r.rating ? Math.min(10, Math.round(r.rating * 2)) : 7,
    feedback_score: 0,
    local_insight: null as string | null,
    notes: null as string | null,
    is_active: true,
    approval_status: 'auto' as const,
    source: 'discovered' as const,
    city_id: city.id,
    discovered_at: new Date().toISOString(),
  };
}
```

`buildPhotoUrl` takes the key as a param (no module-global key). Note `mapGoogleTypes` must return one of the `place_type` enum values — keep the exact rule table from the script (it already maps to valid enum values).

Add `searchText` as a thin fetch (port `googleSearchText`), parameterized by city centroid + radius + API key, with the **same field mask plus `places.businessStatus`**:

```ts
export async function searchText(query: string, opts: {
  apiKey: string; lat: number; lng: number; radiusKm: number;
}): Promise<GoogleResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': opts.apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.priceLevel,places.rating,places.userRatingCount,places.businessStatus,places.photos,places.regularOpeningHours,places.websiteUri',
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      locationBias: { circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: opts.radiusKm * 1000 } },
    }),
  });
  if (!res.ok) throw new Error(`Google searchText ${res.status}: ${await res.text()}`);
  return ((await res.json()).places ?? []) as GoogleResult[];
}
```

**Step 1.4 — run green. Step 1.5 — commit:** `M1: port Google Places mappers + quality floor to Deno (google-places.ts)`.

---

### Task 2 — Migration: `places.city_id` + `source` + indexes

**Files:** Create `supabase/migrations/20260601210000_m1_places_city_source.sql`.

**Step 2.1 — prod-drift gate (C8).** Before writing, MCP read-only verify prod `places` columns (does `google_place_id`/`discovered_at`/`source_query` exist? expect yes). Record findings as a comment in the migration header.

**Step 2.2 — write migration:**

```sql
-- M1: city-scope + provenance for places. Multi-city + on-the-fly cache.
-- Verified on prod ufufmcpnysvwtutpbian 2026-06-01: places has google_place_id,
-- discovered_at (drift capture). [confirm before apply]
alter table places
  add column if not exists city_id uuid references cities(id),
  add column if not exists source text not null default 'curated'
    check (source in ('curated','discovered','warmed'));

-- Backfill: every existing curated row belongs to Kelowna.
update places
   set city_id = (select id from cities where slug = 'kelowna')
 where city_id is null;

create index if not exists idx_places_city_id on places (city_id);
create index if not exists idx_places_city_approval
  on places (city_id, approval_status) where is_active;
```

(Leave `city_id` nullable — backfill fills it; future discovered rows always set it. A `NOT NULL` would block any path that inserts before assigning a city; not worth the risk for the stopgap.)

**Step 2.3 — apply locally** (`supabase db reset` runs all migrations via `_all_5b.sh` step 1, or `supabase migration up`). Confirm no error.

**Step 2.4 — commit:** `M1: places.city_id + source column + indexes (backfill Kelowna)`.

---

### Task 3 — Migration: add `'auto'` to `place_approval_status` (own file, C3)

**Files:** Create `supabase/migrations/20260601210100_m1_approval_status_auto.sql`.

**Step 3.1 — write (ONLY this statement in the file):**

```sql
-- M1: 'auto' = machine-discovered, usable for solo planning + landing,
-- BUT blocked from dating meetups (enforced in post_night). Must be its own
-- migration: ADD VALUE commits before later migrations can reference it.
alter type place_approval_status add value if not exists 'auto';
```

**Step 3.2 — apply locally**, confirm the enum now has the value:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select enum_range(null::place_approval_status);"
```
Expect `{draft,live,rejected,auto}`.

**Step 3.3 — commit:** `M1: add 'auto' to place_approval_status enum (own non-tx migration)`.

---

### Task 4 — Migration: `cities.centroid_lat/centroid_lng` scalars + backfill

**Files:** Create `supabase/migrations/20260601210200_m1_cities_centroid_scalars.sql`.

Rationale: `filterPlaces` does in-memory haversine and needs numeric lat/lng. We derive scalars from the existing `centroid geography(Point,4326)` so providers never touch PostGIS.

**Step 4.1 — write:**

```sql
-- M1: scalar centroid for in-memory radius filtering (filterPlaces is JS haversine, not PostGIS).
alter table cities
  add column if not exists centroid_lat numeric,
  add column if not exists centroid_lng numeric;

update cities
   set centroid_lat = ST_Y(centroid::geometry),
       centroid_lng = ST_X(centroid::geometry)
 where centroid is not null
   and (centroid_lat is null or centroid_lng is null);
```

**Step 4.2 — apply locally**, verify Kelowna row:
```bash
psql "$DB_URL" -c "select slug, centroid_lat, centroid_lng, default_radius_km from cities;"
```
Expect `kelowna | 49.888 | -119.496 | 40`.

**Step 4.3 — commit:** `M1: cities.centroid_lat/lng scalars (backfill from centroid)`.

---

### Task 5 — Migration: `feature_config` provider map seed

**Files:** Create `supabase/migrations/20260601210300_m1_feature_config_providers.sql`.

**Step 5.1 — write:**

```sql
-- M1: per-city generation provider map. Runtime-flippable, no redeploy.
-- "_default" applies to any city without an explicit entry.
insert into feature_config (key, value)
values ('generation_providers',
  '{"kelowna":"kelowna","_default":"onthefly"}'::jsonb)
on conflict (key) do nothing;
```

**Step 5.2 — apply locally**, verify:
```bash
psql "$DB_URL" -c "select value from feature_config where key='generation_providers';"
```

**Step 5.3 — commit:** `M1: seed feature_config generation_providers map`.

---

### Task 6 — `places-filter.ts`: city-scope + de-Kelowna-lock

**Files:** Modify `supabase/functions/generate-plan/places-filter.ts`, `types.ts`.

**Step 6.1 — add `CityRecord` to `types.ts`:**
```ts
export interface CityRecord {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  timezone: string;
  centroid_lat: number;
  centroid_lng: number;
  default_radius_km: number;
}
```
Add `city_slug?: string;` to `PlanInputs`.

**Step 6.2 — failing test** is impractical here (DB query, blocked by C2). Instead extract the **pure radius predicate** so it IS testable. Add to `places-filter.ts` and test it:

`places-filter.test.ts` (create):
```ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { withinRadius } from './places-filter.ts';

Deno.test('withinRadius: keeps places with null coords, applies haversine otherwise', () => {
  const kel = { lat: 49.888, lng: -119.496 };
  assertEquals(withinRadius(null, null, kel.lat, kel.lng, 30), true);   // unknown coords pass
  assertEquals(withinRadius(49.89, -119.50, kel.lat, kel.lng, 30), true);
  assertEquals(withinRadius(51.05, -114.07, kel.lat, kel.lng, 30), false); // Calgary, far
});
```

**Step 6.3 — impl.** Change `filterPlaces(supabase, inputs)` → `filterPlaces(supabase, inputs, city: CityRecord)`. Replace the hardcoded `KELOWNA_LAT/LNG` with `city.centroid_lat/lng`; default radius from `city.default_radius_km` when `inputs.max_radius_km` absent. Add `.eq('city_id', city.id)` to the query and the `select` list (add `city_id,source` columns). Export a pure `withinRadius(lat,lng,cLat,cLng,maxKm)` wrapping the existing haversine. Keep `coversAllMustIncludes` unchanged.

**Approval-status filter decision (load-bearing):** keep `KelownaProvider` on `approval_status = 'live'` only (preserves curated-quality for the established city). For the on-the-fly path, freshly-warmed rows are `'auto'`, so `filterPlaces` must accept `'auto'` when serving an on-the-fly city. Make the accepted statuses a parameter:
```ts
export async function filterPlaces(
  supabase: SupabaseClient, inputs: PlanInputs, city: CityRecord,
  approvalStatuses: string[] = ['live'],
): Promise<Place[]> { ... .in('approval_status', approvalStatuses) ... }
```
`KelownaProvider` passes `['live']`; `OnTheFlyProvider` passes `['live','auto']`. This keeps Kelowna curated-only while letting a cold city plan off its just-warmed `'auto'` rows. (Dating-publish restriction is separate — Task 12.)

**Step 6.4 — run green. Step 6.5 — commit:** `M1: city-scope filterPlaces + pure withinRadius + parameterized approval statuses`.

---

### Task 7 — `prompt.ts`: thread city name/region into the LLM copy

**Files:** Modify `supabase/functions/generate-plan/prompt.ts`.

**Step 7.1 — failing test.** The interesting unit is the user-message builder. Export `buildUserMessage` (currently module-private) and test that city threads through:

`prompt.test.ts` (create):
```ts
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildSystemPrompt, buildUserMessage } from './prompt.ts';

Deno.test('buildSystemPrompt injects city + region, not hardcoded Kelowna', () => {
  const sys = buildSystemPrompt({ name: 'Vernon', region: 'BC' });
  assertStringIncludes(sys, 'Vernon');
  // Default Kelowna call still mentions Kelowna (back-compat)
  assertStringIncludes(buildSystemPrompt({ name: 'Kelowna', region: 'BC' }), 'Kelowna');
});

Deno.test('buildUserMessage states the city for couples', () => {
  const msg = buildUserMessage({
    inputs: { occasion: 'date', vibe: ['chill'], budget_per_person: 50, duration_min: 180, effort: 'low', must_includes: [] } as any,
    itineraries: [], placesById: new Map(), city: { name: 'Vernon', region: 'BC' },
  } as any);
  assertStringIncludes(msg, 'Vernon');
});
```

**Step 7.2 — impl.** Convert the const `SYSTEM_PROMPT` into `buildSystemPrompt(city: { name: string; region: string | null })` — replace "for couples in Kelowna" / "Okanagan specificity: lake light, vineyards…" with city-parameterized text. Keep an Okanagan-specific sensory line *only* when `city.name === 'Kelowna'` (so the established city loses nothing); otherwise use a generic local-specificity instruction ("Lean into ${city.name} specificity — name real neighborhoods, local landmarks, the feel of the place."). Add `city` to `WritingPassInput`; in `buildUserMessage`, change the hardcoded couples line to reference `city.name`. Pass `city` from `runPipeline` (Task 8). Export `buildUserMessage` + `buildSystemPrompt`.

**Step 7.3 — run green. Step 7.4 — commit:** `M1: de-Kelowna-lock the LLM prompt (city/region threaded)`.

---

### Task 8 — Extract `runPipeline` + `persist`

**Files:** Create `providers/pipeline.ts`, `persist.ts`; modify `index.ts`.

This is a **pure refactor** — behavior must not change for Kelowna. No new test asserts new behavior; the safety net is the existing E2E + a smoke generation (Task 13). Use `superpowers:verification-before-completion`.

**Step 8.1 — `providers/types.ts`:**
```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Itinerary, PlanInputs, CityRecord } from '../types.ts';

export interface GenerationContext {
  inputs: PlanInputs;
  city: CityRecord;
  supabase: SupabaseClient;
  env: { anthropicKey: string; anthropicModel: string; googleKey?: string; railwayUrl?: string; railwayToken?: string };
  log: Record<string, unknown>; // sharedLog accumulator
}

export interface DateGenerationProvider {
  readonly name: string;
  generate(ctx: GenerationContext): Promise<Itinerary[]>;
}
```

**Step 8.2 — `providers/pipeline.ts`:** move the body of `index.ts` steps 3–7b into `runPipeline(ctx, opts?: { approvalStatuses?: string[] })` returning the `written` `Itinerary[]` (the post-LLM, post-photo-scrub array) **plus** mutating `ctx.log`. Move helpers `pickModifiersForBatch`, `categoryGroupForType`, `fixAdjacency`, `ENFORCED_GROUPS` here. `runPipeline` calls `filterPlaces(supabase, inputs, city, opts?.approvalStatuses ?? ['live'])`. Pass `{ ..., city: { name: ctx.city.name, region: ctx.city.region } }` into `writeItineraries`. On `< 3 candidates` / `must_includes_unsatisfiable` / `no_valid_itineraries`, throw a typed error `class PipelineError extends Error { code: string; httpStatus: number }` so the handler maps it back to the existing 422 bodies (preserve the exact `error`/`message` strings).

**Step 8.3 — `persist.ts`:** move step 8 (computeQualityScore, near-twin dedupe, insertRows, slug update, modifier join, `withIds` build) into `persist(supabase, { written, inputs, modPool, modifierIdsPicked, sharedLog, userId, season }): Promise<WithIdsItinerary[]>`. Keep `slugify` here (or import from a shared spot). The function returns the `withIds` array the handler responds with.

NOTE: modifier selection (step 6) currently sits *before* the LLM pass and feeds both persist and the response. Keep modifier pick inside `runPipeline` and return `{ itineraries, modPool, modifierIdsPicked }` from it, OR compute it in persist. Cleanest: `runPipeline` returns `{ itineraries, modPool, modifierIdsPicked }`; handler passes those to `persist`. Document this in the file header.

**Step 8.4 — slim `index.ts` `serve()`:**
```ts
// after rate-limit:
const citySlug = inputs.city_slug ?? 'kelowna';
const { data: cityRow } = await supabase.from('cities')
  .select('id,slug,name,region,timezone,centroid_lat,centroid_lng,default_radius_km')
  .eq('slug', citySlug).maybeSingle();
if (!cityRow) return jsonResponse({ error: 'unknown_city', message: `No city '${citySlug}'.` }, 422);
const env = { anthropicKey: Deno.env.get('ANTHROPIC_API_KEY')!, anthropicModel: Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6', googleKey: Deno.env.get('GOOGLE_PLACES_API_KEY'), railwayUrl: Deno.env.get('RAILWAY_GENERATOR_URL'), railwayToken: Deno.env.get('RAILWAY_API_TOKEN') };
const provider = await selectProvider(citySlug, supabase);
const ctx = { inputs, city: cityRow, supabase, env, log: {} };
let pipe;
try { pipe = await provider.generate(ctx); }
catch (e) { if (e instanceof PipelineError) return jsonResponse({ error: e.code, message: e.message }, e.httpStatus); throw e; }
const withIds = await persist(supabase, { ...pipe, inputs, sharedLog: ctx.log, userId, season });
return jsonResponse({ itineraries: withIds, generated_at: new Date().toISOString() }, 200, extraHeaders);
```
`provider.generate` returns `{ itineraries, modPool, modifierIdsPicked }` (extend `DateGenerationProvider` return type accordingly, or have providers return that bundle). Keep the existing helpers `extractUserIdFromAuthHeader`, `checkRateLimit*`, `jsonResponse` in `index.ts`.

**Step 8.5 — run full deno suite + typecheck.** `deno test ... generate-plan/`. Then a local smoke generation for Kelowna (Task 13's recipe) to confirm parity. **Step 8.6 — commit:** `M1: extract runPipeline + persist; slim generate-plan handler (Kelowna parity)`.

---

### Task 9 — `KelownaProvider`

**Files:** Create `providers/kelowna.ts`.

**Step 9.1 — impl** (thin wrapper):
```ts
import type { DateGenerationProvider, GenerationContext } from './types.ts';
import { runPipeline } from './pipeline.ts';

export const KelownaProvider: DateGenerationProvider = {
  name: 'kelowna',
  async generate(ctx: GenerationContext) {
    return runPipeline(ctx, { approvalStatuses: ['live'] });
  },
};
```
**Step 9.2 — commit:** `M1: KelownaProvider (current pipeline, live-only)`.

---

### Task 10 — `selectProvider` + provider-map parsing (tested)

**Files:** Create `providers/select.ts`, `providers/select.test.ts`.

**Step 10.1 — failing test:**
```ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { parseProviderMap, resolveProviderName } from './select.ts';

Deno.test('parseProviderMap: tolerates junk, returns {}', () => {
  assertEquals(parseProviderMap(null), {});
  assertEquals(parseProviderMap('garbage'), {});
  assertEquals(parseProviderMap({ kelowna: 'kelowna', _default: 'onthefly' }), { kelowna: 'kelowna', _default: 'onthefly' });
});

Deno.test('resolveProviderName: explicit city wins, else _default, else kelowna', () => {
  const m = { kelowna: 'kelowna', _default: 'onthefly', vancouver: 'railway' };
  assertEquals(resolveProviderName('kelowna', m), 'kelowna');
  assertEquals(resolveProviderName('vancouver', m), 'railway');
  assertEquals(resolveProviderName('vernon', m), 'onthefly');     // _default
  assertEquals(resolveProviderName('vernon', {}), 'kelowna');     // hard fallback
});
```

**Step 10.2 — impl `select.ts`:**
```ts
import type { DateGenerationProvider } from './types.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { KelownaProvider } from './kelowna.ts';
import { OnTheFlyProvider } from './onthefly.ts';
import { RailwayProvider } from './railway.ts';

export type ProviderMap = Record<string, string>;
const REGISTRY: Record<string, DateGenerationProvider> = {
  kelowna: KelownaProvider, onthefly: OnTheFlyProvider, railway: RailwayProvider,
};

export function parseProviderMap(value: unknown): ProviderMap {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: ProviderMap = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
    return out;
  }
  return {};
}

export function resolveProviderName(citySlug: string, map: ProviderMap): string {
  return map[citySlug] ?? map._default ?? 'kelowna';
}

export async function selectProvider(citySlug: string, supabase: SupabaseClient): Promise<DateGenerationProvider> {
  const { data } = await supabase.from('feature_config').select('value').eq('key', 'generation_providers').maybeSingle();
  const map = parseProviderMap((data as { value?: unknown } | null)?.value);
  const name = resolveProviderName(citySlug, map);
  return REGISTRY[name] ?? KelownaProvider;
}
```
**Step 10.3 — run green. Step 10.4 — commit:** `M1: selectProvider + provider-map parsing (feature_config)`.

---

### Task 11 — `OnTheFlyProvider` (warm-then-pipeline)

**Files:** Create `providers/onthefly.ts`, `providers/onthefly.test.ts`.

**Step 11.1 — failing test** for the pure warm-result→rows step + dedupe + quality floor (DB write itself is not unit-tested per C2; isolate the pure transform):
```ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildWarmRows } from './onthefly.ts';

const city = { id: 'c1', slug: 'vernon', name: 'Vernon' } as any;
const ok = { id: 'a', displayName: { text: 'A' }, types: ['cafe'], rating: 4.5, userRatingCount: 40, businessStatus: 'OPERATIONAL', location: { latitude: 50.26, longitude: -119.27 } };
const lowRated = { ...ok, id: 'b', rating: 3.0 };
const dupe = { ...ok, id: 'a' };

Deno.test('buildWarmRows: applies quality floor + dedupes by google_place_id + tags city/auto/discovered', () => {
  const rows = buildWarmRows([ok, lowRated, dupe], city, 'GKEY');
  assertEquals(rows.length, 1);
  assertEquals(rows[0].google_place_id, 'a');
  assertEquals(rows[0].city_id, 'c1');
  assertEquals(rows[0].approval_status, 'auto');
  assertEquals(rows[0].source, 'discovered');
});
```

**Step 11.2 — impl `onthefly.ts`:**
```ts
import type { DateGenerationProvider, GenerationContext } from './types.ts';
import { runPipeline } from './pipeline.ts';
import { searchText, googleResultToPlaceRow, passesQualityFloor, type GoogleResult } from '../google-places.ts';

const CATEGORIES = ['cafe', 'restaurant', 'bar', 'activity', 'park'];

export function buildWarmRows(results: GoogleResult[], city: { id: string; slug: string }, key: string) {
  const seen = new Set<string>();
  const rows = [];
  for (const r of results) {
    if (!r.id || seen.has(r.id)) continue;
    if (!passesQualityFloor(r)) continue;
    seen.add(r.id);
    rows.push(googleResultToPlaceRow(r, city, key));
  }
  return rows;
}

export const OnTheFlyProvider: DateGenerationProvider = {
  name: 'onthefly',
  async generate(ctx: GenerationContext) {
    const { city, env, supabase } = ctx;
    if (!env.googleKey) {
      const { PipelineError } = await import('./pipeline.ts');
      throw new PipelineError('generation_unavailable', 'On-the-fly generation is not configured for this city yet.', 503);
    }
    // Warm only if the city is cold (no auto/live places yet) — keeps repeat
    // generations cheap. (Count, not fetch.)
    const { count } = await supabase.from('places')
      .select('id', { count: 'exact', head: true })
      .eq('city_id', city.id).in('approval_status', ['live', 'auto']).eq('is_active', true);
    if ((count ?? 0) < 12) {
      const queries = CATEGORIES.map((c) => `${c} in ${city.name} ${city.region ?? ''}`.trim());
      const settled = await Promise.allSettled(queries.map((q) =>
        searchText(q, { apiKey: env.googleKey!, lat: city.centroid_lat, lng: city.centroid_lng, radiusKm: city.default_radius_km })));
      const results: GoogleResult[] = [];
      for (const s of settled) if (s.status === 'fulfilled') results.push(...s.value);
      const rows = buildWarmRows(results, city, env.googleKey);
      if (rows.length > 0) {
        // Idempotent: upsert on google_place_id (C7).
        await supabase.from('places').upsert(rows, { onConflict: 'google_place_id', ignoreDuplicates: true });
      }
      ctx.log.warm = { city: city.slug, queried: queries.length, raw: results.length, inserted: rows.length };
    }
    // Reuse the shared pipeline, accepting freshly-warmed 'auto' rows.
    return runPipeline(ctx, { approvalStatuses: ['live', 'auto'] });
  },
};
```
Notes: `places.upsert(... onConflict:'google_place_id')` requires a unique constraint on `google_place_id`. **Verify it exists** (drift capture likely added it); if not, add `create unique index if not exists places_google_place_id_key on places(google_place_id) where google_place_id is not null;` to migration `20260601210000`. The `< 12` cold-check threshold is a heuristic; document it.

**Step 11.3 — run green** (only `buildWarmRows` is unit-tested). **Step 11.4 — commit:** `M1: OnTheFlyProvider — warm Google→places(auto) then reuse pipeline`.

---

### Task 12 — `RailwayProvider` (stub)

**Files:** Create `providers/railway.ts`.

**Step 12.1 — impl:**
```ts
import type { DateGenerationProvider, GenerationContext } from './types.ts';
import type { Itinerary } from '../types.ts';

// STUB — not selected by feature_config yet. Returns the same Itinerary[] shape
// the owner's Railway engine must produce (generate-plan/types.ts). When live,
// the handler persists the result identically to the other providers.
export const RailwayProvider: DateGenerationProvider = {
  name: 'railway',
  async generate(ctx: GenerationContext) {
    const { env, inputs, city } = ctx;
    if (!env.railwayUrl) {
      const { PipelineError } = await import('./pipeline.ts');
      throw new PipelineError('generation_unavailable', 'Railway generator not configured.', 503);
    }
    const res = await fetch(env.railwayUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.railwayToken ? { authorization: `Bearer ${env.railwayToken}` } : {}) },
      body: JSON.stringify({ inputs, city: { slug: city.slug, name: city.name, region: city.region } }),
    });
    if (!res.ok) { const { PipelineError } = await import('./pipeline.ts'); throw new PipelineError('railway_error', `Railway ${res.status}`, 502); }
    const body = await res.json() as { itineraries: Itinerary[] };
    // Railway returns Itinerary[]; modifiers/modPool are pipeline-only, so empty here.
    return { itineraries: body.itineraries, modPool: [], modifierIdsPicked: body.itineraries.map(() => null) };
  },
};
```
A focused test can assert it throws `generation_unavailable` when `railwayUrl` is unset (pure, no network). **Step 12.2 — commit:** `M1: RailwayProvider HTTP stub (returns Itinerary[], not wired)`.

---

### Task 13 — Dating-publish restriction: curated-only venues in `post_night`

**Files:** Create `supabase/migrations/20260601210400_m1_post_night_curated_venue.sql`.

Enforces the locked decision: a real-world meetup (`date_instances.venue_id`) must be a curated `approval_status='live'` place. `'auto'`/discovered venues are blocked.

**Step 13.1 — write** (`create or replace` the existing `post_night`, adding a venue check; preserve signature + grants):
```sql
-- M1: published dating nights may only pin a CURATED ('live') venue.
-- 'auto'/discovered venues are fine for solo planning + the landing, never for meetups.
create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_city uuid; v_ok boolean; v_id uuid; v_venue_ok boolean;
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

  -- NEW: a pinned venue must be a curated, live place. Blocks auto/discovered.
  if p_venue is not null then
    select (approval_status = 'live' and is_active) into v_venue_ok from places where id = p_venue;
    if not coalesce(v_venue_ok,false) then
      raise exception 'venue must be a reviewed (live) place to host a dating meetup' using errcode='P0001';
    end if;
  end if;

  insert into date_instances (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status)
  values (p_itinerary, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking')
  returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function post_night(uuid, timestamptz, uuid, int) from public;
grant execute on function post_night(uuid, timestamptz, uuid, int) to authenticated;
```

**Step 13.2 — local test** via the SQL suite pattern (`supabase/tests/*.sql`, run by `_all_5b.sh` step 2): add an assertion that `post_night(..., p_venue := <an 'auto' place id>)` raises, and that a `'live'` venue succeeds. (Follow the existing pgTAP/`psql ON_ERROR_STOP` style already in `supabase/tests/`.)

**Step 13.3 — run advisor (C8) after applying. Step 13.4 — commit:** `M1: post_night restricts pinned venue to curated 'live' places`.

---

### Task 14 — Frontend: thread `city_slug` (default 'kelowna')

**Files:** Modify `apps/web/app/plan/page.tsx`; `supabase/functions/generate-plan/index.ts` (Zod, if not already in Task 8).

**Step 14.1 — Zod** (in `index.ts` `InputSchema`): add
```ts
city_slug: z.string().min(1).max(60).default('kelowna'),
```
**Step 14.2 — `Inputs` interface** (page.tsx, ~line 79): add `city_slug: string;`. In the initial `useState` inputs object (~line 281), add `city_slug: 'kelowna'`. The invoke `body` already spreads `inputs`, so it threads automatically; confirm no field strips it.

**Step 14.3 — verify** typecheck + a build (`pnpm --filter @after5/web typecheck`). **Step 14.4 — commit:** `M1: add optional city_slug to generate-plan input + thread from /plan`.

---

### Task 15 — Wire `generate-plan/` into the deno test run + final suite

**Files:** Modify `supabase/tests/_all_5b.sh`.

**Step 15.1 —** change step 4 glob to include the new dir:
```bash
deno test --allow-env --allow-net \
  --import-map=supabase/functions/_shared/_test_import_map.json \
  supabase/functions/match-*/ supabase/functions/generate-plan/ supabase/functions/_shared/
```
**Step 15.2 — run the full deno suite:**
```bash
deno test --allow-env --allow-net \
  --import-map=supabase/functions/_shared/_test_import_map.json \
  supabase/functions/generate-plan/
```
Confirm all M1 tests green and no regression in `match-*`/`_shared`. **Step 15.3 — commit:** `M1: run generate-plan deno tests in 5b suite`.

---

### Task 16 — Deploy notes + secrets provisioning (NOT auto-applied)

This task is a checklist, not code. Execute only on the owner's go.

1. **Prod-drift verify (C8):** MCP `list_tables` / `execute_sql` to confirm prod `places` (`google_place_id` unique?), `cities`, `feature_config` match assumptions. Reconcile any drift in the migrations before apply.
2. **Apply migrations batched, in order:** `210000` → `210100` (enum, own tx) → `210200` → `210300` → `210400`. Run `get_advisors` (security + performance) after; expect no new warnings.
3. **Provision edge secrets (C5 — the edge fn has never called Google before):**
   ```bash
   supabase secrets set GOOGLE_PLACES_API_KEY=... RAILWAY_GENERATOR_URL=... RAILWAY_API_TOKEN=...
   ```
   `GOOGLE_PLACES_API_KEY` is required for any `_default:onthefly` city; without it on-the-fly returns a clean 503 `generation_unavailable`. `RAILWAY_*` only needed when a city is mapped to `railway`.
4. **Deploy the function:** `supabase functions deploy generate-plan` (MCP `deploy_edge_function`).
5. **Smoke (Kelowna parity):** POST a known-good body with no `city_slug` → expect 3 itineraries, identical shape to today. Then with `city_slug:'kelowna'` → identical. Leave `_default` as `onthefly` but do NOT seed a second city in this milestone — on-the-fly is validated separately when a real second city is chosen.
6. **Provider flip is runtime:** to point a city at the Railway engine later, `update feature_config set value = jsonb_set(value,'{vancouver}','"railway"') where key='generation_providers';` — no redeploy.

---

## Done criteria

- `deno test ... supabase/functions/generate-plan/` green; full `_all_5b.sh` step 4 green.
- A Kelowna generation (no `city_slug`) returns byte-identical response shape to pre-M1 (parity smoke).
- `selectProvider` resolves `kelowna→KelownaProvider`, unknown city→`onthefly` (per seed), and is runtime-flippable.
- `post_night` rejects an `'auto'` venue and accepts a `'live'` venue.
- Migrations apply clean locally; advisor clean; prod apply gated on C8 verification.
- No frontend contract change beyond additive optional `city_slug`.

---

## Open question for the owner

**Railway request/response contract is unspecified.** `RailwayProvider` currently POSTs `{ inputs, city }` and expects `{ itineraries: Itinerary[] }` (the `generate-plan/types.ts` shape). The owner's separate engine must confirm it (a) accepts that input envelope and (b) returns that exact `Itinerary[]` shape (including `stops[].place_id` / `what_to_do` / cost+duration fields) — otherwise `RailwayProvider` needs a translation layer, not a pass-through. Also: should Railway-returned places be persisted into `places` (for the dating-publish path) or treated as ephemeral plan-only stops? That decision changes whether the seam needs a place-upsert step before `persist()`.
