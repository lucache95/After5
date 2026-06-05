# Phase 8: Compliant Any-City Venue Corpus - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** mvp — bare-minimum; refactor/harden the EXISTING generate-plan venue pipeline, do not rebuild

<domain>
## Phase Boundary

Make the `places` corpus that feeds the AI date-planner **legally sourced** and **trustworthy in any city**. Three requirements:
- **DATA-01** — Foursquare Places becomes the canonical, stored, LLM-fed corpus; remove the Google Places → LLM path (violates Google's 2026 Maps ToS). Google is dropped from the pipeline entirely for MVP.
- **DATA-02** — Pre-seed a user's city into `places` (async, on profile-location-set) + a synchronous cold-start fallback at generation time with a "warming up" state.
- **DATA-03** — Proximity + hours validators fail loud on missing data (no silent pass), so a cold city cannot read valid when it isn't.

**In scope:** the venue-corpus + ingestion + guard layer of `supabase/functions/generate-plan/`. NOT generation quality/UX (Phase 9), NOT wiring into the dating create flow (Phase 10).

**This is a refactor of LIVE prod code** — `generate-plan` edge fn v46 is deployed + reachable. Gated-prod-apply discipline applies; the live Foursquare key is an external dependency the user must provide before prod ingestion + the gated apply.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Foursquare integration shape
- New `supabase/functions/generate-plan/foursquare.ts` that mirrors `google-places.ts`'s mapper/fetch interface (drop-in corpus source: `GoogleResult`-analog → `placeRow` mapper, Text/Place Search fetch, city geocode).
- Foursquare **new** Places API only (legacy V3 deprecates 2026-05-15 — do not build on V3).
- **Drop Google from the pipeline entirely for MVP** — Foursquare supplies venue photos too. Fully compliant, single-source, simplest. (A Google display-only photo layer keyed by `google_place_id` is explicitly deferred.)
- Field mapping: Foursquare → existing `places` columns (name; categories → `type` place_type enum + cuisine; geocodes → lat/lng decimal(9,6); hours → opens/closes; price tier; locality → neighborhood) + ADD `fsq_place_id text` + `source text`. Reuse the existing quality-floor + slugify + neighborhood/drive_cluster derivation patterns.

### Area 2 — Existing Google-warmed data
- Add a `source` column to `places`; relabel existing Google-sourced rows `source='google_legacy'` and **exclude them from the candidate pool / LLM input**; re-warm lazily from Foursquare when their city is next used.
- Keep curated Kelowna rows as `source='curated'` — the gold path, untouched (hand-filled coords/hours = the reference quality bar).
- Leave existing published nights intact (their stops are frozen jsonb); only NEW generations use the Foursquare corpus.
- Mechanism: a migration adds `source` + `fsq_place_id` + a one-time labeling pass (mark existing google rows). NO bulk-delete (preserves rows any published night references).

### Area 3 — City pre-seed + cold-start
- Trigger app-side: after the user saves their profile location, enqueue a `seed_city` job; the `process-jobs` cron handler fetches Foursquare for that city and upserts into `places`.
- Cold-start (city not yet seeded at generation time): synchronous live Foursquare fetch inline; if still thin/slow, surface a "warming up — check back in a moment" state. NEVER an error or a broken/garbage date.
- Seed scope: bounded — top-N venues across the date-relevant categories (bars, restaurants, cafes, activities), capped per city for cost/latency. Not a whole-city crawl.
- Refresh/staleness: MVP seeds once + records `seeded_at`; no auto-refresh (deferred to a future milestone).

### Area 4 — Fail-loud guards (DATA-03)
- Venue missing coords → **exclude** from candidate selection + log (fix `withinRadius` at `places-filter.ts:90` to return false on null lat/lng, not true).
- Venue missing hours → don't assert open: exclude from prime/time-sensitive slots + surface an `unverified` marker (fix `isOpenAt` at `scoring.ts:53` so null hours ≠ "always open").
- City too thin to make a good date → a clear "not enough spots in {city} yet" state, never a garbage date.
- Compute + persist `unverified_rate` per city (the share of candidate venues with missing coords/hours) — a first-class signal that feeds the Phase 9 eval.

### Claude's Discretion
- Exact Foursquare endpoint/params, category→place_type mapping table, seed cap N, job payload shape, and the `places` migration column types — within the secure-by-default + gated-prod-apply conventions.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/generate-plan/google-places.ts` — the interface to mirror: `GoogleResult` interface, `googleResultToPlaceRow(r, city, key)` mapper, `geocodeCity`, `passesQualityFloor`, `mapGoogleTypes`, `priceLevelToTier`, `neighborhoodFromLatLng`, `driveClusterFromNeighborhood`, `slugify`, `pickHours`, `radiusFromViewport`. `foursquare.ts` should provide the same surface.
- `providers/onthefly.ts` + `providers/{kelowna,railway,select,pipeline}.ts` — the provider abstraction the cold-start fetch plugs into.
- `places-filter.ts` (`withinRadius` line 83-90 — the silent-pass coords bug) + `scoring.ts` (`isOpenAt` line 52-53 — the silent-pass hours bug) — the two guards DATA-03 fixes.
- `persist.ts` — how generated plans/places persist.
- `process-jobs` edge fn + `handlers.ts` — the job-handler pattern for the `seed_city` job (mirror the v1.0 job handlers).
- `apps/web/scripts/{discover,enrich,mine-reviews}.mjs` — existing venue-ingestion scripts (Google-based; reference for the Foursquare ingestion shape).

### Established Patterns
- `places` table: id, name, slug, address, neighborhood, drive_cluster, lat/lng decimal(9,6), type (place_type enum), cuisine[], vibe_tags[], effort, energy, pairing_tags[], time_of_day[], weather_dependent, weather_works_in, (opens/closes hours, price tier below). Migration adds `fsq_place_id` + `source` + (per-city) `seeded_at`.
- Secure-by-default + gated-prod-apply (from v1.0): any new RPC/migration pins search_path, RLS, revoke-anon; advisor after DDL; local-green → gated prod-apply (NOT auto-pushed; prod ufufmcpnysvwtutpbian). Foursquare API key SERVER-SIDE only (edge fn secret).

### Integration Points
- `generate-plan` edge fn (v46, live) — swap the corpus source google→foursquare inside it.
- `apps/web/app/api/create-plan/route.ts` — the server proxy that invokes generate-plan (unchanged this phase).
- profile location field (set during onboarding / `/account/preferences`) — the pre-seed trigger point.
- `process-jobs` cron — runs the `seed_city` handler.
</code_context>

<specifics>
## Specific Ideas
- External dependency (BLOCKER for prod): a live Foursquare new-Places-API key, server-side only. The build + local tests use a mocked Foursquare client + fixtures; live ingestion + the gated prod-apply pause for the user's key.
- Pre-check (roadmapper flag): confirm the Foursquare new Places API free-tier transition (legacy V3 deprecates 2026-05-15) and verify the live prod state of `generate-plan` / `places` before refactoring.
- Compliance is the point: NO Google Maps content stored as content or fed to the LLM after this phase.
</specifics>

<deferred>
## Deferred Ideas
- Google display-only photo/map layer keyed by `google_place_id` (kept compliant, but added complexity — defer).
- Venue-data freshness/auto-refresh (seed-once for MVP).
- Multi-city expansion as a marketed capability (on-demand per-user seeding only).
- OSM/Overpass lat/lng backfill for thin cities (only if Foursquare coverage proves inadequate).
</deferred>
