# Phase 8: Compliant Any-City Venue Corpus - Research

**Researched:** 2026-06-05
**Domain:** Edge-function venue ingestion (Deno) + Postgres migration + async job pipeline + guard refactor
**Confidence:** HIGH on API endpoint/auth/params (official Foursquare docs), HIGH on codebase integration surface (read directly), MEDIUM on Foursquare hours/photo response detail (docs confirm structure; exact JSON sample not retrieved live), MEDIUM on free-tier numbers (mid-transition).

## Summary

This phase swaps the venue corpus that feeds the AI date-planner from Google Places (New) to the **new Foursquare Places API** (`https://places-api.foursquare.com`, NOT legacy V3 which deprecates 2026-05-15), because Google's April-2026 Maps ToS §3.2.3 forbids both caching venue content and feeding it to an LLM — exactly what the live `generate-plan` pipeline does today. The work is a **refactor of live prod code**, not a rebuild: a new `foursquare.ts` mirrors the existing `google-places.ts` mapper/fetch surface (`searchPlaces` → `fsqResultToPlaceRow`, `geocodeCity`, `passesQualityFloor`, category mapper, `pickHours`), the `OnTheFlyProvider` re-points at it, a migration adds `source`/`fsq_place_id`/`seeded_at` to `places` and relabels existing Google rows `google_legacy` (excluded from the candidate pool), a new `seed_city` job handler pre-warms a user's city after profile-location-set, and the two silent-pass guards (`withinRadius`, `isOpenAt`) are fixed to fail loud on null data with an `unverified` marker threaded through.

**Primary recommendation:** Build `foursquare.ts` as a drop-in corpus source using a single `GET /places/search` per category (the new API returns hours/photos/price/rating/categories inline via the `fields` param — **no separate Place Details call needed**, halving cost vs. a search+details model). Keep the existing cold-threshold gate, idempotent-upsert, provider abstraction, and Deno-test+plain-object-mock patterns unchanged. Fix the guards to exclude (not silently pass) null coords/hours and compute `unverified_rate` per city as a first-class Phase-9 eval signal.

**Biggest implementation risk:** Foursquare's `hours.regular` is an array of per-day `{day, open, close}` objects (day 1=Mon..7=Sun, `"HHMM"` strings), which is a **completely different shape** from Google's `weekdayDescriptions` free-text array that `pickHours` parses today. If the new `pickHours` is mis-mapped (e.g. day index off-by-one, or `"1730"` not parsed to `17:30`), every Foursquare venue lands with null hours, the (newly fail-loud) `isOpenAt` guard then excludes them from prime slots, and a cold city silently degrades to "not enough spots" — the exact silent-quality-collapse failure this phase exists to prevent, now triggered by a mapper bug instead of a guard bug. This must be the first thing unit-tested against a fixture.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Foursquare API fetch + field mapping | Edge Function (`generate-plan/foursquare.ts`) | — | Server-side only; API key is an edge secret, never client-exposed |
| City pre-seed (async) | Edge Function (`process-jobs` handler) + DB (`jobs` queue) | App (`/api/.../route.ts` enqueue) | Mirrors v1.0 cron-job pattern; bounded background work |
| Cold-start live fetch | Edge Function (`generate-plan`, inline in `OnTheFlyProvider`) | — | Synchronous, in the generation request path |
| `places` corpus + provenance | Database (migration + RLS) | — | `source`/`fsq_place_id`/`seeded_at` columns; public-read table |
| Proximity / hours guards | Edge Function (`places-filter.ts`, `scoring.ts`) | — | Pure deterministic validators, in-memory over candidate pool |
| "Warming up" / "not enough spots" signal | Edge Function (error envelope) → App (UI state) | — | `PipelineError` code → existing frontend handler |
| `unverified_rate` per city | Edge Function (compute) → DB (persist, optional) | — | Feeds Phase 9 eval; computed over the candidate pool |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
**Area 1 — Foursquare integration shape**
- New `supabase/functions/generate-plan/foursquare.ts` mirrors `google-places.ts`'s mapper/fetch interface (drop-in corpus source).
- Foursquare **new** Places API only (legacy V3 deprecates 2026-05-15 — do not build on V3).
- **Drop Google from the pipeline entirely for MVP** — Foursquare supplies venue photos too. Single-source, fully compliant. (A Google display-only photo layer keyed by `google_place_id` is explicitly deferred.)
- Field mapping: Foursquare → existing `places` columns (name; categories → `type` enum + cuisine; geocodes → lat/lng decimal(9,6); hours → opens/closes; price tier; locality → neighborhood) + ADD `fsq_place_id text` + `source text`. Reuse quality-floor + slugify + neighborhood/drive_cluster derivation.

**Area 2 — Existing Google-warmed data**
- Add a `source` column; relabel existing Google rows `source='google_legacy'` and **exclude them from the candidate pool / LLM input**; re-warm lazily from Foursquare when their city is next used.
- Keep curated Kelowna rows as `source='curated'` — untouched gold path.
- Leave existing published nights intact (frozen jsonb stops); only NEW generations use the Foursquare corpus.
- Migration adds `source` + `fsq_place_id` + a one-time labeling pass. NO bulk-delete (preserves rows any published night references).

**Area 3 — City pre-seed + cold-start**
- App-side trigger: after the user saves their profile location, enqueue a `seed_city` job; `process-jobs` handler fetches Foursquare + upserts.
- Cold-start (city not yet seeded at generation time): synchronous live Foursquare fetch inline; if still thin/slow, surface a "warming up — check back in a moment" state. NEVER an error or a broken date.
- Seed scope: bounded — top-N venues across date-relevant categories (bars, restaurants, cafes, activities), capped per city.
- Refresh: MVP seeds once + records `seeded_at`; no auto-refresh (deferred).

**Area 4 — Fail-loud guards (DATA-03)**
- Venue missing coords → **exclude** + log (fix `withinRadius` at `places-filter.ts:90` to return false on null lat/lng).
- Venue missing hours → don't assert open: exclude from prime/time-sensitive slots + surface an `unverified` marker (fix `isOpenAt` at `scoring.ts:53` so null hours ≠ "always open").
- City too thin → a clear "not enough spots in {city} yet" state, never a garbage date.
- Compute + persist `unverified_rate` per city (share of candidate venues with missing coords/hours) — first-class Phase-9 eval signal.

### Claude's Discretion
- Exact Foursquare endpoint/params, category→place_type mapping table, seed cap N, job payload shape, and the `places` migration column types — within secure-by-default + gated-prod-apply conventions.

### Deferred Ideas (OUT OF SCOPE)
- Google display-only photo/map layer keyed by `google_place_id`.
- Venue-data freshness / auto-refresh (seed-once for MVP).
- Multi-city expansion as a marketed capability.
- OSM/Overpass lat/lng backfill for thin cities (only if Foursquare coverage proves inadequate).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Foursquare Places becomes the canonical, stored, LLM-fed corpus; remove the Google→LLM path | Standard Stack (Foursquare new Places API), Architecture Pattern 1 (`foursquare.ts` mirror), Code Examples (search + mappers), Migration (relabel `google_legacy`) |
| DATA-02 | Pre-seed a user's city into `places` (async on profile-location-set) + synchronous cold-start fallback with a "warming up" state | Architecture Pattern 2 (`seed_city` job), Pattern 3 (cold-start inline), Code Examples (handler + enqueue) |
| DATA-03 | Proximity + hours validators fail loud on missing data; no silent pass | Architecture Pattern 4 (guard fixes), Code Examples (`withinRadius`/`isOpenAt`), `unverified_rate` computation |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **GSD workflow enforcement:** all edits go through a GSD command (`/gsd:execute-phase`).
- **Secure-by-default RLS:** never `USING(true)` on update/delete; run the Supabase security advisor after every DDL; review live migrations before prod apply. `places` is public-read — the migration must not regress that.
- **Gated prod-apply:** local-green before batched prod apply; prod ref `ufufmcpnysvwtutpbian`; watch local↔prod drift.
- **API keys server-side only:** Foursquare key is an edge-function secret (Supabase dashboard), never `NEXT_PUBLIC_`, never in `.env` committed files.
- **Migrations:** numbered `.sql` files in `supabase/migrations/`, idempotent (`if not exists`, `do $$ ... exception when duplicate_object`), pin `search_path = public` on any new function, `revoke execute ... from public, authenticated` on definer RPCs.
- **TypeScript/Deno conventions:** named exports only; explicit return types on exported functions; `import type` for type-only imports; discriminated unions for result types; never silent catches.
- **Edge fn import style:** pinned `https://esm.sh/@supabase/supabase-js@2.45.0` and `https://deno.land/std@0.208.0/...` URLs (Deno, no node_modules).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Foursquare Places API (new) | API version header `2025-06-17` | Canonical venue corpus: search + fields + geocode | The one source whose license permits fetch + store-forever + LLM-feed + display (per VENUE-DATA.md). [CITED: docs.foursquare.com/fsq-developers-places/reference/place-search] |
| Deno `fetch` (built-in) | runtime | HTTP calls to Foursquare | `google-places.ts` already uses native `fetch` — zero new dependencies [VERIFIED: read google-places.ts] |
| `@supabase/supabase-js` | 2.45.0 (pinned esm.sh) | DB upsert from edge fn | Already the project standard [VERIFIED: codebase] |
| Deno std `assert` | `std@0.208.0` | Edge-fn unit tests | Existing test pattern (`onthefly.test.ts`) [VERIFIED: read onthefly.test.ts] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | — | This phase adds **no npm/Deno packages**. Foursquare is plain REST over `fetch`; tests use plain-object fixtures. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Foursquare `fetch` REST | `foursquare-places-mcp` (official MCP server) | MCP server is for agent tooling, not edge-runtime ingestion — wrong layer. Reject. |
| Search-only (`fields` inline) | Search + per-place `GET /places/{id}` Details | Details doubles the call count and cost for no gain — search returns hours/photos/price/rating inline via `fields`. Use search-only. |
| Google Places (current) | — | **Illegal** for store+LLM (§3.2.3). Dropped, per locked decision. |

**Installation:** No package install. Add an edge-function secret:
```bash
# Server-side only — set in Supabase dashboard / via CLI, never committed
supabase secrets set FOURSQUARE_API_KEY=<service_key> --project-ref ufufmcpnysvwtutpbian
```

**Version verification:** No registry package to verify. The API "version" is the `X-Places-Api-Version: 2025-06-17` header value (the current stable dated version of the new Places API as of this research) [CITED: docs.foursquare.com/fsq-developers-places/reference/place-search]. Confirm the live value at integration time — Foursquare may publish a newer date string.

## Package Legitimacy Audit

> No external packages are installed in this phase. The Foursquare integration is plain REST over Deno's built-in `fetch`, matching the existing `google-places.ts` pattern. Tests use plain-object fixtures with no live key. slopcheck/registry verification is **not applicable** — there is nothing to install.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Foursquare New Places API — Reference (the load-bearing API facts)

> Build on the **new** Places API (`places-api.foursquare.com`), NOT legacy V3 (`api.foursquare.com/v3/places`), which **deprecates 2026-05-15** [CITED: docs.foursquare.com/developer/reference/upcoming-changes].

### Endpoints

| Purpose | Endpoint | Method |
|---------|----------|--------|
| Search venues near a point | `https://places-api.foursquare.com/places/search` | GET |
| Place details (NOT needed — search returns everything via `fields`) | `https://places-api.foursquare.com/places/{fsq_place_id}` | GET |

[CITED: docs.foursquare.com/fsq-developers-places/reference/place-search] [CITED: docs.foursquare.com/fsq-developers-places/reference/place-details]

### Auth (two required headers)

```
Authorization: Bearer <FOURSQUARE_API_KEY>
X-Places-Api-Version: 2025-06-17
```

This is a **breaking change from V3**, which used a bare `Authorization: <key>` (no `Bearer`) and no version header. [CITED: docs.foursquare.com/fsq-developers-places/reference/place-search] [VERIFIED: web search — multiple sources confirm `Authorization: Bearer` + `X-Places-Api-Version` for the new API]

### Request params (`GET /places/search`, query string)

| Param | Type | Use for After5 |
|-------|------|----------------|
| `ll` | string `"lat,lng"` | City centroid (from `geocodeCity`) |
| `near` | string | Free-text city fallback if no centroid yet |
| `radius` | int (0–100000, **meters**) | `city.default_radius_km * 1000` |
| `fsq_category_ids` | comma-separated category IDs | Constrain to date-relevant categories (table below) |
| `query` | string | Optional keyword (e.g. "coffee") — category IDs are preferred |
| `fields` | comma-separated field names | Request inline hours/photos/price/rating to avoid a Details call |
| `min_price` / `max_price` | int 1–4 | Optional price gating |
| `open_now` / `open_at` | boolean / string | Leave unset for seeding (we store hours, filter at generation) |
| `sort` | `RELEVANCE`/`RATING`/`DISTANCE`/`POPULARITY` | `POPULARITY` or `RATING` for quality-first seeding |
| `limit` | int 1–**50** | Seed cap per category (top-N) |

[CITED: docs.foursquare.com/fsq-developers-places/reference/place-search]

### Response fields (per place) → `places` column mapping

| Foursquare field | Shape | → `places` column | Notes |
|------------------|-------|-------------------|-------|
| `fsq_place_id` | string | **NEW** `fsq_place_id text` | Stable join/upsert key (was `fsq_id` in V3) |
| `name` | string | `name` | |
| `latitude` | number | `lat decimal(9,6)` | Top-level in new API (V3 nested under `geocodes.main`) |
| `longitude` | number | `lng decimal(9,6)` | |
| `location.address` | string | part of `address` | |
| `location.locality` | string | `neighborhood` (non-Kelowna) | Reuse the `city.slug`-fallback logic from `googleResultToPlaceRow` |
| `location.region` / `postcode` / `country` / `formatted_address` | strings | `address` (compose) | |
| `categories[].fsq_category_id` + `.name` | array | `type` (place_type enum) + `cuisine[]` | Map via taxonomy table below |
| `hours.regular[]` | `[{day:1-7, open:"HHMM", close:"HHMM"}]` | `opens` / `closes` (time) | **Different shape from Google** — see Pitfall 1 + new `pickHours` |
| `hours.open_now` / `hours.display` | bool / string | (informational) | |
| `price` | int 1–4 | `price_tier` ('$'/'$$'/'$$$') | 1→$, 2→$$, 3 or 4→$$$ |
| `rating` | number 0.0–10.0 | `quality_score` (already 0–10!) | **No ×2 scaling** — FSQ rating is already on a 10-scale, unlike Google's 5-scale |
| `popularity` | number 0.0–1.0 | (quality-floor signal) | |
| `photos[]` | `[{prefix, suffix, width, height, ...}]` | `photo_url` | URL = `prefix + {size} + suffix` (see Pitfall 2) |
| `website` / `tel` | string | `reservation_url` (website) | |
| `date_closed` | string | exclude if present | Closed-venue signal for quality floor |

[CITED: docs.foursquare.com/fsq-developers-places/reference/response-fields] [CITED: docs.foursquare.com/developer/reference/response-fields]

### Category taxonomy → `place_type` enum

Foursquare uses a 1000+ category taxonomy with stable IDs. Seed by **top-level category IDs** in `fsq_category_ids`, then map the granular returned `categories[].name` to our enum in a `mapFsqCategories` function (mirrors `mapGoogleTypes`). Top-level IDs to seed across date-relevant categories [CITED: docs.foursquare.com/data-products/docs/categories]:

| Foursquare top-level category | Top-level ID (verify at build time) | After5 date category |
|-------------------------------|-------------------------------------|----------------------|
| Dining and Drinking | `4d4b7105d754a06374d81259` | restaurant / cafe / bar / dessert |
| Arts and Entertainment | `4d4b7104d754a06370d81259` | activity / gallery |
| Landscapes and Outdoors | `4d4b7105d754a06377d81259` | park / beach / hike / viewpoint / walk |
| Retail | `4d4b7105d754a06378d81259` | shop / market |

**`mapFsqCategories` rule list** (first match wins, fallback `'activity'`), keyed on lowercased `categories[].name` substrings:
`winery`→winery, `brewery`/`beer`→brewery, `bar`/`cocktail`/`pub`/`nightclub`→cocktail_bar, `coffee`/`café`/`cafe`→cafe, `bakery`→bakery, `ice cream`→ice_cream, `dessert`→dessert, `restaurant`/`diner`/`eatery`→restaurant, `art gallery`→gallery, `beach`→beach, `park`→park, `garden`→garden, `trail`/`hiking`→hike, `scenic`/`lookout`/`overlook`→viewpoint, `market`→market, `museum`/`bowling`/`spa`/`arcade`→activity.

> ⚠️ The exact top-level category IDs above are `[ASSUMED]` — they are the long-standing Foursquare top-level IDs from training data, surfaced by the categories doc, but the precise ID strings were **not** re-verified field-by-field in this session against the live `fsq_category_id` table. Verify against `docs.foursquare.com/data-products/docs/categories` (or pull the live category list) before locking them into the seed query. (See Assumptions Log A1.)

### Rate limits / pricing / free tier (MEDIUM confidence — mid-transition)

- Legacy V3 deprecates **2026-05-15**. New Places API & V2 Pro rates take effect **2026-06-01** [CITED: docs.foursquare.com/developer/reference/upcoming-changes].
- New free tier: **500 free Pro calls/mo**, then tiered CPM: ~$15 CPM (501–100k) down to ~$1.25 CPM (5M+) [CITED: upcoming-changes pricing table].
- A bounded seed of ~4 category searches × 1 call ≈ **4 calls/city**; search-only (no Details) keeps cost negligible at After5's scale. Cost is not the constraint — licensing is.
- `[ASSUMED]` exact free-allowance numbers may shift; confirm the signed-account allowance at key provisioning. (Assumptions Log A2.)

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
   profile location  ──► │ App: /api/account/... saves primary_city_id  │
      saved (onboarding) │   → resolve city slug → enqueue_job('seed_city', {city_id})
                         └───────────────┬─────────────────────────────┘
                                         │ (dedup_key = city_id; idempotent)
                                         ▼
                              ┌──────────────────────┐
                              │ jobs table (pending)  │
                              └──────────┬────────────┘
   Vercel Cron (1/min) ──► process-jobs ─┤ claim_due_jobs
                              ┌──────────▼────────────┐
                              │ HANDLERS['seed_city']  │
                              │  → foursquare.searchPlaces() per category (Bearer + version hdr)
                              │  → fsqResultToPlaceRow() → quality floor
                              │  → upsert places ON CONFLICT fsq_place_id
                              │  → stamp cities/place seeded_at
                              └────────────────────────┘

   user taps "Plan a date"
        │
        ▼
   generate-plan (edge) ──► selectProvider(city) ──► OnTheFlyProvider
        │                                              │
        │            cold? (count < COLD_THRESHOLD) ───┤ yes ► inline foursquare.searchPlaces() + upsert
        │                                              │ still thin ► PipelineError('city_warming', 503)
        ▼                                              ▼
   runPipeline ──► filterPlaces (source ≠ google_legacy; withinRadius FAILS LOUD on null coords)
        │       ──► scoring   (isOpenAt FAILS LOUD on null hours → exclude from timed slots, mark unverified)
        │       ──► compute unverified_rate over candidate pool
        ▼
   itineraries (LLM copy over frozen fsq-sourced place_ids)  +  unverified_rate in audit log
```

### Recommended Project Structure
```
supabase/functions/generate-plan/
├── foursquare.ts            # NEW — mirrors google-places.ts surface
├── foursquare.test.ts       # NEW — mapper + pickHours + category unit tests (fixtures, no key)
├── google-places.ts         # KEPT but unreferenced by pipeline (dead after swap; optional delete)
├── places-filter.ts         # EDIT — withinRadius fail-loud
├── scoring.ts               # EDIT — isOpenAt fail-loud + unverified marker
├── providers/
│   ├── onthefly.ts          # EDIT — import foursquare instead of google-places
│   └── pipeline.ts          # EDIT (optional) — compute unverified_rate into sharedLog
supabase/functions/process-jobs/
├── handlers.ts              # EDIT — add HANDLERS['seed_city']
├── seed-city.ts             # NEW (optional split) — seed handler body
supabase/migrations/
└── 20260605xxxxxx_data01_places_fsq_source.sql   # NEW
```

### Pattern 1: `foursquare.ts` as a drop-in mirror of `google-places.ts`
**What:** Provide the identical exported surface so `onthefly.ts` swaps one import line. Required exports: `searchPlaces` (≈ `searchText`), `fsqResultToPlaceRow` (≈ `googleResultToPlaceRow`), `geocodeCity`, `passesQualityFloor`, `mapFsqCategories` (≈ `mapGoogleTypes`), `priceToTier` (≈ `priceLevelToTier`), `pickHours`, `slugify`, `radiusFrom...`, and a `FsqResult` interface (≈ `GoogleResult`). Reuse `neighborhoodFromLatLng`/`driveClusterFromNeighborhood`/`slugify` verbatim (import or copy).
**When to use:** Always — minimizes blast radius and keeps Kelowna behavior byte-identical (curated rows untouched).

### Pattern 2: `seed_city` job (mirror the v1.0 job-handler pattern)
**What:** Add `'seed_city'` to the `job_type` enum (migration), add `HANDLERS['seed_city']` in `process-jobs/handlers.ts`. The handler reads `payload.city_id`, loads the city, runs the same `searchPlaces`+`fsqResultToPlaceRow`+upsert as cold-start, stamps `seeded_at`. Throw on hard failure so `index.ts` retries with backoff (dead-letters at attempts≥5).
**When to use:** Async pre-seed after profile-location-set. Enqueue with `enqueue_job('seed_city', now(), {city_id}, p_dedup_key := city_id)` — dedup_key = city_id means a city already queued/running won't double-seed (poison-loop safety, matches v1.0).
**App-side enqueue:** `enqueue_job` is `revoke`d from `authenticated`, so enqueue from a **server route** using the admin/service-role client (the route that persists `primary_city_id`), not from the browser.

### Pattern 3: Cold-start inline fetch (already exists — re-source it)
**What:** `OnTheFlyProvider` already does count-gate → fetch → upsert → `runPipeline`. Re-point its fetch at `foursquare.searchPlaces`, change `onConflict` to `fsq_place_id`, change the env guard from `env.googleKey` to `env.foursquareKey`. If after the inline warm the candidate pool is still `< 3` usable, throw `PipelineError('city_warming', 'We're still gathering great spots in {city} — check back in a moment.', 503)` instead of the generic `no_candidates` so the client can show the "warming up" state distinctly.
**When to use:** Generation in an unseeded/thin city.

### Pattern 4: Fail-loud guards (DATA-03)
**What:** Invert the two silent-pass predicates.
- `withinRadius` (`places-filter.ts:90`): `if (typeof lat !== 'number' || typeof lng !== 'number') return false;` (was `return true`). A venue with no coords cannot be proximity-validated → exclude.
- `isOpenAt` (`scoring.ts:52`): null hours must NOT mean "always open". Return a richer result or treat null-hours as "not eligible for a time-sensitive slot". Concretely: keep the `!slotStart` relaxed-mode bypass, but when `slotStart` is set and `!p.opens || !p.closes`, return `false` (exclude from timed slots) AND mark the place `unverified` so the stop/plan can carry the signal.
**Unverified threading:** add an `unverified?: boolean` to the candidate/stop shape; set it when a place is admitted with missing hours via the relaxed path. Compute `unverified_rate = (# candidates with null coords OR null hours) / (# candidates)` in `runPipeline`, write to `sharedLog.unverified_rate` (and optionally persist per-city for the Phase-9 eval).

### Anti-Patterns to Avoid
- **Silent-pass guards** — the entire reason this phase exists. Never `return true` on null geo/hours.
- **Per-place Place Details calls** — search returns hours/photos/price/rating inline via `fields`; a Details call per venue doubles cost for nothing.
- **Bulk-deleting Google rows** — published nights' frozen jsonb may reference them; relabel `google_legacy` and exclude from the pool instead (locked decision).
- **Kelowna neighborhood buckets on other cities** — `neighborhoodFromLatLng` is Kelowna-tuned; non-Kelowna cities must use the `city.slug` fallback (already handled in `googleResultToPlaceRow` — preserve it).
- **`X-Goog-FieldMask`-style thinking** — Foursquare uses a `fields` query param, not a Google-style header field mask. Request the fields explicitly or you may get a thin default projection.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotent city pre-seed | Custom "have we seeded this city?" table + locking | `enqueue_job(..., p_dedup_key := city_id)` + `ON CONFLICT fsq_place_id` upsert | The jobs queue already gives active-dedup + retry/backoff/dead-letter; the unique index gives row-level idempotency |
| Job retry / poison-loop safety | Manual attempt counting | Existing `fail_job` backoff (dead-letters at attempts≥5) | Battle-tested in v1.0; the handler just throws on failure |
| City geocode | A second geocoding provider | Foursquare `near` param OR `geocodeCity` via FSQ search top result | Single source; no extra API to enable |
| Photo URL CDN handling | Storing photo bytes | `prefix + size + suffix` URL stored as text (as today with Google) | Foursquare permits storing the photo reference/URL |
| Hours "is it open now" at seed time | Pre-computing open/closed | Store `hours.regular` → `opens`/`closes`; let `isOpenAt` decide per-slot | Separation already in the pipeline |

**Key insight:** Almost everything this phase needs (idempotent upsert, job retry, provider abstraction, cold-threshold gate, Deno-test fixtures) **already exists** for the Google path. The work is a targeted re-source + two guard inversions + one migration + one job handler, not new infrastructure.

## Runtime State Inventory

> This is a corpus re-source with a data-relabel pass — runtime state matters.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `places` rows with `source='discovered'` (Google-warmed) holding Google `name`/`address`/`photo_url`/hours in non-Kelowna cities; `places` rows `source='curated'` (Kelowna gold). Existing `places_google_place_id_key` UNIQUE index on `google_place_id`. | Migration: add `source` value `'google_legacy'`, relabel `discovered` rows → `google_legacy`; exclude from candidate pool (filter `source <> 'google_legacy'` or `in ('curated','foursquare')`). Add `fsq_place_id` + full UNIQUE index for the new upsert arbiter. Keep `curated` untouched. NO delete (published nights reference rows). |
| Live service config | `feature_config` key `generation_providers` maps city→provider (`onthefly`/`kelowna`/`railway`). Lives in DB, not git. | No change required for MVP (onthefly stays the any-city provider) — but verify the prod map doesn't pin a city to a now-dead path. |
| OS-registered state | None — seeding runs via Supabase cron (`process-jobs`) + Vercel Cron, not OS schedulers. | None. |
| Secrets/env vars | `GOOGLE_PLACES_API_KEY` (edge secret, set on prod). NEW: `FOURSQUARE_API_KEY` must be provisioned (BLOCKER for prod ingestion). | Set `FOURSQUARE_API_KEY` as a Supabase edge secret before the gated prod-apply. `GOOGLE_PLACES_API_KEY` can remain unused (no display layer this phase). |
| Build artifacts | None — Deno edge functions, no compiled artifact carrying old state. | None. |

**Canonical check:** After every file is updated, the only stale runtime state is (a) Google-content `places` rows — handled by the `google_legacy` relabel + pool exclusion, and (b) the missing `FOURSQUARE_API_KEY` secret — handled at provisioning. No OS-registered or build-artifact state.

## The Migration (DATA-01 + DATA-02 schema)

**Single migration** `20260605xxxxxx_data01_places_fsq_source.sql`, idempotent:

1. **Extend `source` check** — `places.source` currently `check (source in ('curated','discovered','warmed'))`. Drop+recreate the check to add `'foursquare'` and `'google_legacy'`. (Use `alter table ... drop constraint ... ; add constraint ...` guarded; the original constraint is unnamed in M1, so query/recreate carefully or use a `do $$` block.)
2. **Add `fsq_place_id text`** + a **full** unique index `places_fsq_place_id_key on places (fsq_place_id)` (NULLs distinct — mirrors the `google_place_id` fix in `20260602160000`; a partial index is NOT a valid `ON CONFLICT` arbiter for supabase-js).
3. **Add `seeded_at timestamptz`** on `places` (or on a per-city tracking column on `cities`). **Recommendation:** add `cities.seeded_at timestamptz` — seed state is per-city, not per-place; this is one row to check at cold-start ("has this city ever been seeded?") vs. scanning places. (Discretion area; per-city is cleaner.)
4. **One-time relabel pass:** `update places set source = 'google_legacy' where source = 'discovered';` (the Google-warmed rows). Curated Kelowna rows (`source='curated'`) untouched.
5. **No RLS change** — `places` is public-read; do not add `USING(true)` anything. Re-run the security advisor after apply (CLAUDE.md).

**Gated prod-apply:** local-green first; the relabel pass is a NO-OP where there are no `discovered` rows (local/CI). Prod has Google-warmed rows → verify count before/after. Review against prod `places` state (M1 + M35 already applied per memory).

## Common Pitfalls

### Pitfall 1: Foursquare hours shape ≠ Google hours shape (the biggest risk)
**What goes wrong:** `pickHours` today parses Google's `weekdayDescriptions: ["Wednesday: 11:00 AM – 10:00 PM", ...]` free-text. Foursquare returns `hours.regular: [{day: 3, open: "1100", close: "2200"}, ...]` (day 1=Mon..7=Sun, `"HHMM"` 24h strings). A naive reuse yields null hours for every venue.
**Why it happens:** Same column target (`opens`/`closes`), totally different source structure.
**How to avoid:** Write a NEW `pickHours(hours: FsqHours)` that picks a representative weekday (e.g. `day === 3`, Wednesday, or first available), parses `"1730"` → `"17:30"` (`HH:` + `MM`), returns `{opens, closes}`. Unit-test against a fixture FIRST.
**Warning signs:** Cold-city `unverified_rate` near 100%; all Foursquare venues excluded from timed slots after the guard fix.

### Pitfall 2: Photo URL assembly
**What goes wrong:** Foursquare photos are `{prefix, suffix}` fragments, not a full URL. `prefix` = `https://fastly.4sqi.net/img/general/`, `suffix` = `/xxxx.jpg`. The full URL is `prefix + <size> + suffix` where `<size>` is `original` or `WIDTHxHEIGHT` (e.g. `600x600`).
**How to avoid:** `buildFsqPhotoUrl(p) => p.prefix + 'original' + p.suffix` (or a fixed `800x600`). Store the assembled URL in `photo_url` (as today). Add `next.config.js` `remotePatterns` for `*.4sqi.net` / `fastly.4sqi.net` if the dating UI renders these images directly. [CITED: docs.foursquare.com/developer/reference/places-photos-guide structure; size values 32/44/64/88/120 are for category icons, photos use original or WxH]
**Warning signs:** Broken images / Next Image host-not-allowed errors.

### Pitfall 3: Rating scale (don't double it)
**What goes wrong:** `googleResultToPlaceRow` does `Math.round(r.rating * 2)` because Google rating is 0–5 and `quality_score` is 0–10. Foursquare `rating` is **already 0.0–10.0**. Reusing the ×2 overflows (`quality_score` is `decimal(4,2)`, max ~99.99, but values >10 break the scoring math and the quality floor).
**How to avoid:** `quality_score = Math.min(10, Math.round(r.rating))` (no ×2). Quality floor uses `rating >= 7.0` (≈ Google's 4.0/5) instead of `>= 4.0`.
**Warning signs:** Every Foursquare venue scores 10; quality floor admits everything.

### Pitfall 4: Cold-city thin data → silent "not enough spots"
**What goes wrong:** A genuinely thin city seeds few usable venues; after the (correct) fail-loud guards exclude null-coord/null-hours rows, the pool drops below 3 and generation fails. Without a distinct signal this looks like a bug.
**How to avoid:** Distinct `PipelineError('city_warming', ..., 503)` for "seeded but thin / still warming" vs. the existing `no_candidates` 422. Surface the "not enough spots in {city} yet" / "warming up" state in the client. Never return a garbage date.
**Warning signs:** Users in new cities get generic 422s.

### Pitfall 5: `ON CONFLICT fsq_place_id` needs a FULL unique index
**What goes wrong:** A partial index `where fsq_place_id is not null` is NOT a valid `ON CONFLICT` arbiter for supabase-js/PostGREST — this exact bug already bit the Google path (fix `20260602160000`). The curated rows have NULL `fsq_place_id`; a full unique index is still valid (Postgres treats NULLs as distinct).
**How to avoid:** Create a FULL unique index from the start (learned from M35).
**Warning signs:** "no unique or exclusion constraint matching the ON CONFLICT specification"; 0 rows upserted; cold city returns no_candidates.

### Pitfall 6: Auth header drift (Bearer + version)
**What goes wrong:** Copying the V3 `Authorization: <key>` (no Bearer) or omitting `X-Places-Api-Version` → 401/400 on the new API.
**How to avoid:** Always send both `Authorization: Bearer <key>` and `X-Places-Api-Version: 2025-06-17`.
**Warning signs:** 401 Unauthorized / 400 missing version on every call.

### Pitfall 7: Test mocking without a live key
**What goes wrong:** Tests that call real `fetch` need a key and network → can't run in CI.
**How to avoid:** Mirror `onthefly.test.ts` — unit-test the **pure mappers** (`fsqResultToPlaceRow`, `pickHours`, `mapFsqCategories`, `passesQualityFloor`, `priceToTier`) against plain-object `FsqResult` fixtures, no `fetch`. For the fetch-shaped `searchPlaces`, inject a mock via `globalThis.fetch` stub or a `fetchImpl` param. Gate any live-key integration test behind `if (!Deno.env.get('FOURSQUARE_API_KEY')) return;`.

## Code Examples

### Foursquare place search (Deno, native fetch)
```typescript
// foursquare.ts — Source pattern: docs.foursquare.com/fsq-developers-places/reference/place-search
const FSQ_HOST = 'https://places-api.foursquare.com';
const FSQ_API_VERSION = '2025-06-17';

const SEARCH_FIELDS = [
  'fsq_place_id','name','latitude','longitude','location','categories',
  'hours','price','rating','popularity','photos','website','tel','date_closed',
].join(',');

export interface FsqResult {
  fsq_place_id: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  location?: { address?: string; locality?: string; region?: string; postcode?: string; formatted_address?: string };
  categories?: { fsq_category_id?: string; name?: string }[];
  hours?: { regular?: { day: number; open: string; close: string }[]; display?: string; open_now?: boolean };
  price?: number;        // 1..4
  rating?: number;       // 0.0..10.0  (already 10-scale — do NOT ×2)
  popularity?: number;   // 0.0..1.0
  photos?: { prefix?: string; suffix?: string; width?: number; height?: number }[];
  website?: string;
  tel?: string;
  date_closed?: string;
}

export async function searchPlaces(opts: {
  apiKey: string; lat: number; lng: number; radiusKm: number;
  categoryIds: string; limit?: number;
}, fetchImpl: typeof fetch = fetch): Promise<FsqResult[]> {
  const url = new URL(`${FSQ_HOST}/places/search`);
  url.searchParams.set('ll', `${opts.lat},${opts.lng}`);
  url.searchParams.set('radius', String(Math.round(opts.radiusKm * 1000)));
  url.searchParams.set('fsq_category_ids', opts.categoryIds);
  url.searchParams.set('fields', SEARCH_FIELDS);
  url.searchParams.set('sort', 'POPULARITY');
  url.searchParams.set('limit', String(opts.limit ?? 50));
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${opts.apiKey}`,
      'X-Places-Api-Version': FSQ_API_VERSION,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Foursquare search ${res.status}: ${await res.text()}`);
  return ((await res.json()).results ?? []) as FsqResult[];
}
```

### Hours mapper (the high-risk one — test first)
```typescript
// FSQ: hours.regular = [{ day: 1..7 (Mon..Sun), open: "1100", close: "2200" }]
export function pickHours(hours: FsqResult['hours']): { opens: string | null; closes: string | null } {
  const reg = hours?.regular;
  if (!reg || reg.length === 0) return { opens: null, closes: null };
  const pick = reg.find((r) => r.day === 3) ?? reg[0]; // Wednesday, else first
  const fmt = (hhmm: string | undefined): string | null => {
    if (!hhmm || !/^\d{4}$/.test(hhmm)) return null;
    return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
  };
  return { opens: fmt(pick.open), closes: fmt(pick.close) };
}
```

### Fail-loud guards (DATA-03)
```typescript
// places-filter.ts — was `return true` on null coords (silent pass).
export function withinRadius(lat, lng, centroidLat, centroidLng, maxKm): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false; // EXCLUDE, don't assume in-range
  return haversineKm(lat, lng, centroidLat, centroidLng) <= maxKm;
}

// scoring.ts — null hours must not read "always open" for a timed slot.
function isOpenAt(p: Place, slotStart: string): boolean {
  if (!slotStart) return true;            // relaxed mode unchanged
  if (!p.opens || !p.closes) return false; // EXCLUDE from time-sensitive slots (was `return true`)
  // ... existing same-day / wraparound logic ...
}
```

### `seed_city` handler (mirror v1.0 pattern)
```typescript
// process-jobs/handlers.ts
const seedCity: Handler = async (db, job) => {
  const cityId = id(job, 'city_id');
  if (!cityId) throw new Error('seed_city: missing city_id');
  const { data: city } = await db.from('cities')
    .select('id,slug,name,region,default_radius_km, ST_Y(centroid::geometry) as lat, ST_X(centroid::geometry) as lng')
    .eq('id', cityId).single();
  // ... searchPlaces per category id → fsqResultToPlaceRow → quality floor → upsert onConflict fsq_place_id
  // ... db.from('cities').update({ seeded_at: new Date().toISOString() }).eq('id', cityId)
};
// register: HANDLERS['seed_city'] = seedCity;
```

### App-side enqueue (server route, service-role)
```typescript
// where primary_city_id is saved (server route only — enqueue_job is revoked from authenticated)
await adminDb.rpc('enqueue_job', {
  p_type: 'seed_city',
  p_run_after: new Date().toISOString(),
  p_payload: { city_id: cityId },
  p_dedup_key: cityId,   // one active seed per city — poison-loop safe
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Foursquare V3 (`api.foursquare.com/v3/places`, `Authorization: <key>`, `fsq_id`, nested `geocodes.main`) | New Places API (`places-api.foursquare.com`, `Authorization: Bearer`, `X-Places-Api-Version`, `fsq_place_id`, top-level `latitude`/`longitude`) | V3 deprecates 2026-05-15 | Build only on the new API |
| Google Places as cached LLM corpus | Foursquare as cached LLM corpus; Google dropped | Google ToS §3.2.3 (Apr 2026) | Compliance blocker resolved |
| Silent-pass guards (`return true` on null) | Fail-loud guards (`return false` / exclude) | This phase | Cold-city trust |

**Deprecated/outdated:**
- Foursquare V3 endpoints (`/v3/places/...`): deprecate 2026-05-15 — do not use.
- Google `google-places.ts` / `onthefly.ts` Google path: legally non-compliant for store+LLM; dropped from the pipeline.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The four top-level Foursquare category IDs (Dining and Drinking `4d4b7105d754a06374d81259`, etc.) are correct/current | Category taxonomy | Wrong IDs → empty or wrong-category seed results. Verify against the live categories table before locking the seed query. |
| A2 | New free tier = 500 Pro calls/mo; CPM ~$15→$1.25; effective 2026-06-01 | Rate limits/pricing | Cost-model only (negligible at scale); confirm signed-account allowance at key provisioning. |
| A3 | `X-Places-Api-Version: 2025-06-17` is the current stable version string | Auth | A newer required version string → 400s. Confirm at integration. |
| A4 | Photo URL = `prefix + 'original' + suffix` (or `WxH`); `*.4sqi.net` host | Pitfall 2 | Broken images only; cosmetic, easily corrected. |
| A5 | Search with `fields` returns hours/photos/price inline (no Details call) | Standard Stack | If a Details call is required for some fields, cost doubles. Verify the response includes requested fields in the first live call. |
| A6 | Foursquare `rating` is 0.0–10.0 (not 0–5) | Pitfall 3 | Wrong scaling → quality_score overflow or floor mis-set. Confirmed by response-fields doc but re-check first live response. |

## Open Questions

1. **Seed cap N per city**
   - What we know: `limit` max is 50 per search; ~4 category searches/city.
   - What's unclear: Whether 50/category (≤200/city) is the right corpus size vs. latency at cold-start.
   - Recommendation: Start at `limit: 30` per category (≤120/city); tune after the Phase-9 eval. Discretion area.

2. **`seeded_at` on `cities` vs `places`**
   - What we know: Cold-start needs a cheap "is this city seeded?" check.
   - Recommendation: `cities.seeded_at` (one row) over per-place. Discretion area.

3. **Where exactly is `primary_city_id` saved app-side?**
   - What we know: Column is `profiles.primary_city_id` (M1 P0). Onboarding steps exist; the exact route that writes it wasn't pinned in this pass.
   - Recommendation: Planner greps `primary_city_id` writes in `apps/web/app` (onboarding/preferences/account) and adds the enqueue there, server-side. Low risk — single insertion point.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `FOURSQUARE_API_KEY` (edge secret) | Live ingestion + gated prod-apply | ✗ (user must provide) | — | Build + all unit tests use plain-object fixtures (no key); live ingestion blocks until provided |
| Supabase CLI / local stack | Migration + edge fn local test | ✓ (project standard) | — | — |
| Deno (edge runtime + tests) | `foursquare.ts` + tests | ✓ (Supabase stack) | 1.x | — |
| `jobs` queue + `enqueue_job`/`claim_due_jobs` | `seed_city` job | ✓ (live, P2) | — | — |
| PostGIS (`cities.centroid`) | City centroid → ll | ✓ (P0 extension) | — | — |

**Missing dependencies with no fallback for PROD:** `FOURSQUARE_API_KEY` — BLOCKER for live ingestion + the gated prod-apply. Build/test proceeds without it.

## Validation Architecture

> nyquist_validation assumed enabled (no `.planning/config.json` override read as false).

### Test Framework
| Property | Value |
|----------|-------|
| Framework (edge fn) | Deno test (`Deno.test`, `https://deno.land/std@0.208.0/assert/mod.ts`) |
| Framework (app/SQL) | Vitest 2.1.8 (`vitest.config.ts`, `vitest.workspace.ts`); Playwright for E2E |
| Config file | `supabase/functions/*` use Deno; `vitest.config.ts` for packages/app |
| Quick run command | `deno test supabase/functions/generate-plan/foursquare.test.ts` |
| Full suite command | `pnpm test` (vitest) + edge-fn Deno tests |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | `fsqResultToPlaceRow` maps name/lat/lng/category/price/hours/photo + `fsq_place_id`/`source='foursquare'` | unit | `deno test .../foursquare.test.ts` | ❌ Wave 0 |
| DATA-01 | `pickHours` parses `hours.regular` `"HHMM"`→`"HH:MM"`, picks Wed/first, null on empty | unit | `deno test .../foursquare.test.ts` | ❌ Wave 0 |
| DATA-01 | `mapFsqCategories` maps FSQ category names → place_type enum; fallback `activity` | unit | `deno test .../foursquare.test.ts` | ❌ Wave 0 |
| DATA-01 | `priceToTier` 1→$,2→$$,3/4→$$$; `passesQualityFloor` rating≥7 | unit | `deno test .../foursquare.test.ts` | ❌ Wave 0 |
| DATA-01 | `searchPlaces` sends Bearer + version headers + ll/radius/fields/categories (mock `fetchImpl`) | unit | `deno test .../foursquare.test.ts` | ❌ Wave 0 |
| DATA-01 | Migration: `source='google_legacy'` rows excluded from `filterPlaces` pool | integration/SQL | local DB apply + `filterPlaces` test | ❌ Wave 0 |
| DATA-02 | `HANDLERS['seed_city']` upserts on `fsq_place_id` idempotently; stamps `seeded_at` | unit (mock db) | `deno test .../process-jobs/handlers_test.ts` | ⚠️ extend existing |
| DATA-02 | enqueue dedup: second `seed_city` for same `city_id` returns same job id | SQL | local `enqueue_job` test | ❌ Wave 0 |
| DATA-02 | Cold-start thin city → `PipelineError('city_warming', 503)` not garbage date | unit | `deno test .../onthefly.test.ts` (extend) | ⚠️ extend existing |
| DATA-03 | `withinRadius` returns false on null lat/lng | unit | `deno test .../places-filter.test.ts` | ❌/⚠️ Wave 0 |
| DATA-03 | `isOpenAt` returns false on null hours for a timed slot; true in relaxed mode | unit | `deno test .../scoring.test.ts` | ❌/⚠️ Wave 0 |
| DATA-03 | `unverified_rate` computed = (null-coord OR null-hours)/total over candidate pool | unit | `deno test .../pipeline.test.ts` | ❌ Wave 0 |

### Mock-Foursquare-client approach (tests run without a live key)
- **Pure mappers:** test `fsqResultToPlaceRow`/`pickHours`/`mapFsqCategories`/`priceToTier`/`passesQualityFloor` against hand-built `FsqResult` fixtures (exactly like `onthefly.test.ts` builds `ok`/`lowRated`/`dupe` objects). No network, no key.
- **`searchPlaces`:** accept an injectable `fetchImpl: typeof fetch = fetch` param (shown in the code example); pass a stub returning `{ results: [...fixtures] }` and assert the request URL/headers (Bearer, version, ll, radius, categories, fields).
- **Handler:** pass a fake `db` (object with `.from().select()/.upsert()` returning canned data) — matches the existing `handlers_test.ts` mock-db convention.
- **Live integration (optional, key-gated):** `if (!Deno.env.get('FOURSQUARE_API_KEY')) return;` so CI skips it; only runs locally when the user provides a key.

### Sampling Rate
- **Per task commit:** `deno test supabase/functions/generate-plan/foursquare.test.ts` (+ the touched guard test)
- **Per wave merge:** full edge-fn Deno tests + `pnpm test`
- **Phase gate:** full suite green + local migration apply + advisor clean before `/gsd:verify-work`; live Foursquare smoke + gated prod-apply require the user's key.

### Wave 0 Gaps
- [ ] `supabase/functions/generate-plan/foursquare.test.ts` — mapper + pickHours + category + searchPlaces (mock fetch) — covers DATA-01
- [ ] `supabase/functions/generate-plan/places-filter.test.ts` (or extend) — `withinRadius` null-coord — covers DATA-03
- [ ] `supabase/functions/generate-plan/scoring.test.ts` (or extend) — `isOpenAt` null-hours — covers DATA-03
- [ ] `unverified_rate` test (in a pipeline test) — covers DATA-03
- [ ] Extend `process-jobs/handlers_test.ts` — `seed_city` idempotent upsert — covers DATA-02
- [ ] FSQ response **fixtures** file (1 rich venue, 1 null-hours, 1 null-coords, 1 below-floor) — shared across the above
- [ ] Framework install: none — Deno + Vitest already present

## Security Domain

> `security_enforcement` assumed enabled (no explicit `false`).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new user-auth surface |
| V3 Session Management | no | — |
| V4 Access Control | yes | `enqueue_job` stays `revoke`d from `authenticated` — enqueue only from a server route via service-role; `places` public-read unchanged; no `USING(true)` on update/delete |
| V5 Input Validation | yes | Validate/clamp `city_id` (uuid) in the handler; sanitize free-text city before sending to Foursquare `near`; Zod on any new app route input |
| V6 Cryptography | no | `FOURSQUARE_API_KEY` stored as an edge secret (never client/committed) — secret handling, not crypto |
| V9 Communications | yes | All Foursquare calls over HTTPS (`places-api.foursquare.com`); key only in the `Authorization` header server-side |

### Known Threat Patterns for {Deno edge fn + Postgres + external API}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leakage to client | Information Disclosure | Key is an edge secret; never `NEXT_PUBLIC_`; never in request bodies returned to client |
| Unbounded seed (cost/DoS) | Denial of Service | `limit` cap + bounded category set + `dedup_key=city_id` (one active seed/city) + cold-threshold gate |
| Job poison loop | Denial of Service | Existing `fail_job` backoff + dead-letter at attempts≥5; handler throws cleanly on failure |
| SQL injection via city/category | Tampering | Parameterized supabase-js queries; `fsq_category_ids` from a fixed server-side constant list, not user input |
| RLS regression on `places` | Elevation/Disclosure | Migration adds columns only; re-run security advisor after DDL (CLAUDE.md) |
| Compliance (the point) | — | NO Google Maps content stored or LLM-fed after this phase; Foursquare attribution ("Powered by Foursquare") tracked for the display surface |

## Sources

### Primary (HIGH confidence)
- [Foursquare Place Search reference](https://docs.foursquare.com/fsq-developers-places/reference/place-search) — endpoint, Bearer + `X-Places-Api-Version: 2025-06-17`, all params, response field list
- [Foursquare Place Details reference](https://docs.foursquare.com/fsq-developers-places/reference/place-details) — `/places/{fsq_place_id}` (confirmed not needed)
- [Foursquare Response Fields](https://docs.foursquare.com/developer/reference/response-fields) — location/categories/hours(regular day/open/close)/photos/price(1-4)/rating(0-10)/popularity(0-1) structures
- [Foursquare Upcoming Changes](https://docs.foursquare.com/developer/reference/upcoming-changes) — V3 deprecation 2026-05-15; pricing/free-tier effective 2026-06-01
- [Foursquare Categories](https://docs.foursquare.com/data-products/docs/categories) — taxonomy + category-ID tables
- [Foursquare Places Photos Guide](https://docs.foursquare.com/developer/reference/places-photos-guide) — prefix+size+suffix assembly
- Codebase (read directly): `google-places.ts`, `places-filter.ts`, `scoring.ts`, `providers/{onthefly,select,pipeline,kelowna}.ts`, `process-jobs/{index,handlers}.ts`, `20260419193959_initial_schema.sql`, `20260601211000_m1_places_city_source.sql`, `20260602160000_m35_...`, `20260525123100_p2_jobs_rpcs.sql`, `20260525123000_p2_jobs.sql`, `20260525120000_p0_extensions_and_cities.sql`, `onthefly.test.ts`
- `.planning/research/VENUE-DATA.md` + `SUMMARY.md` — decision-level licensing verdict

### Secondary (MEDIUM confidence)
- WebSearch (cross-verified with docs): new host `places-api.foursquare.com`, `fsq_place_id`, photo `prefix`/`suffix` example (`fastly.4sqi.net`), pricing 500 free Pro calls
- [Foursquare Places MCP repo](https://github.com/foursquare/foursquare-places-mcp) — confirms new-API field names

### Tertiary (LOW confidence)
- Top-level category ID strings (A1) — from training data + categories doc, not field-verified live this session

## Metadata

**Confidence breakdown:**
- Standard stack / API endpoint+auth+params: HIGH — official place-search reference fetched directly
- Response field structures (hours/photos/categories): MEDIUM-HIGH — response-fields doc confirms shape; exact live JSON sample not retrieved (key-gated console)
- Category IDs: LOW-MEDIUM — IDs `[ASSUMED]`, verify before locking
- Codebase integration / migration / job pattern: HIGH — read all relevant files directly
- Pitfalls: HIGH — derived from real code (rating ×2, partial-index ON CONFLICT bug, Kelowna neighborhood buckets, hours shape)

**Research date:** 2026-06-05
**Valid until:** 2026-06-20 (Foursquare is mid-transition: V3 deprecates 2026-05-15, pricing changes 2026-06-01 — re-verify the version header + free-tier at integration)
