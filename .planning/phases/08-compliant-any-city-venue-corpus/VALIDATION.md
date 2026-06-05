# Phase 8 — Validation Map (Compliant Any-City Venue Corpus)

**nyquist_compliant: true** — every code-producing task carries an `<automated>` verify command. The two phase-gate live/prod tasks (08-06) are intentionally key-gated/human-gated (`<human-check>` + checkpoints) because they cannot run without the user's Foursquare key and the gated-prod-apply discipline; all logic they smoke is already fixture-covered by Wave 1–2 automated tests, so the Nyquist sampling floor is met without a live key.

## Per-Task Verification

| Plan-Task | Req | Behavior verified | Automated command | Test artifact |
|-----------|-----|-------------------|-------------------|---------------|
| 08-01 T1 | DATA-01 | pickHours / mapFsqCategories / priceToTier / passesQualityFloor RED | `deno test .../generate-plan/foursquare.test.ts` (RED) | foursquare.test.ts + __fixtures__/foursquare.ts |
| 08-01 T2 | DATA-01 | mappers + searchPlaces (Bearer+version) GREEN; rating un-doubled | `deno test .../generate-plan/foursquare.test.ts` | foursquare.ts |
| 08-01 T3 | DATA-01 | searchPlaces request-shape (mock fetchImpl) + null-coord/null-hours mapping | `deno test .../generate-plan/foursquare.test.ts` | foursquare.test.ts |
| 08-02 T1 | DATA-03 | withinRadius false on null coords; haversine cases intact | `deno test .../generate-plan/places-filter.test.ts` | places-filter.test.ts |
| 08-02 T2 | DATA-03 | isOpenAt false on null hours for timed slot; relaxed mode intact; unverified marker | `deno test .../generate-plan/scoring.test.ts` | scoring.test.ts |
| 08-02 T3 | DATA-03 | unverified_rate = (null-coord OR null-hours)/total over pool → sharedLog | `deno test .../generate-plan/pipeline.test.ts` | pipeline.test.ts |
| 08-03 T1 | DATA-01/02 | migration applies clean (source check, fsq_place_id full unique index, cities.seeded_at, relabel) | `supabase db reset` (no error) | 20260606150000 migration |
| 08-03 T2 | DATA-01/02 | columns exist; index NON-partial; source check admits new values; curated preserved | `psql -f supabase/tests/data01_places_fsq_source.sql` | data01_places_fsq_source.sql |
| 08-04 T1 | DATA-01 | env.foursquareKey; filterPlaces excludes google_legacy | `deno test .../generate-plan/places-filter.test.ts` | places-filter.test.ts |
| 08-04 T2 | DATA-01 | onthefly re-sourced to foursquare; upsert onConflict fsq_place_id; buildWarmRows floor+dedupe | `deno test .../generate-plan/providers/onthefly.test.ts` | onthefly.test.ts |
| 08-04 T3 | DATA-02 | thin warmed city → PipelineError('city_warming',503); healthy city generates | `deno test .../generate-plan/providers/onthefly.test.ts` | onthefly.test.ts |
| 08-05 T1 | DATA-02 | 'seed_city' accepted as a job type | `supabase db reset` (no error) | 20260606150100 migration |
| 08-05 T2 | DATA-02 | HANDLERS['seed_city'] upserts onConflict fsq_place_id + stamps seeded_at; throws on missing city_id | `deno test .../process-jobs/handlers_test.ts` | seed-city.ts + handlers_test.ts |
| 08-05 T3 | DATA-02 | server-side dedup'd enqueue wired after primary_city_id save | `pnpm tsc --noEmit` (enqueue helper typechecks) | enqueue-seed-city.ts |
| 08-06 T1 | all | full Deno + vitest suite + both migrations + SQL test + local advisor green, no key | `supabase db reset && deno test ... && pnpm test` | 08-06-SUMMARY.md |
| 08-06 ckpt | all | FOURSQUARE_API_KEY provisioned + version/category confirmed | checkpoint:human-action (blocking) | — |
| 08-06 ckpt | all | gated prod-apply of both migrations + before/after source counts + prod advisor | checkpoint:human-verify (blocking) | — |
| 08-06 T2 | all | live FSQ smoke: source='foursquare' rows, non-null coords + parsed hours, unverified_rate | human-check (key-gated) | 08-06-SUMMARY.md |

## Wave 0 Gaps (test scaffolds created within the plans, no separate wave needed)

All test files are created inside the TDD tasks that need them (RED-first), so there is no dependency on a missing scaffold:
- `__fixtures__/foursquare.ts` + `foursquare.test.ts` — created 08-01 T1
- `scoring.test.ts`, `pipeline.test.ts` — created 08-02
- `onthefly.test.ts` — created 08-04
- `data01_places_fsq_source.sql` (SQL) — created 08-03 T2
- `handlers_test.ts` — extended 08-05 T2 (already exists)
- `places-filter.test.ts` — already exists; extended in 08-02 + 08-04

## Sampling Rate
- Per task commit: the touched `deno test <file>` (+ SQL test where DDL).
- Per wave merge: full edge-fn Deno suite + `pnpm test`.
- Phase gate (08-06): full suite + both migrations + local advisor green (no key); then key-gated live smoke + human-gated prod-apply.

## Multi-Source Coverage Audit

All four source types covered; no unplanned items.

| Source | Item | Covered by |
|--------|------|------------|
| GOAL | "places corpus legally sourced from Foursquare, trustworthy in any city, no silent pass" | 08-01 (FSQ source), 08-04 (Google dropped from path), 08-02 (fail-loud) |
| GOAL (SC1) | Foursquare is the stored/LLM-fed corpus; Google→LLM path gone | 08-01, 08-04 (re-source + google_legacy exclusion) |
| GOAL (SC2) | city pre-seeds on location-set; cold city shows "warming up" | 08-05 (seed_city + enqueue), 08-04 (city_warming) |
| GOAL (SC3) | missing coords/hours fails loud, not a valid-looking fake date | 08-02 (guards + unverified_rate) |
| GOAL (SC4) | Google-warmed row no longer LLM-fed (relabel + exclude) | 08-03 (relabel), 08-04 (pool exclusion) |
| REQ | DATA-01 | 08-01, 08-03, 08-04 |
| REQ | DATA-02 | 08-04 (cold-start), 08-05 (seed + enqueue) |
| REQ | DATA-03 | 08-02 |
| RESEARCH | foursquare.ts mirror surface | 08-01 |
| RESEARCH | pickHours FSQ-shape (Pitfall 1) | 08-01 T1/T2 (tested first) |
| RESEARCH | rating no-×2 (Pitfall 3) | 08-01 T2 |
| RESEARCH | full unique index ON CONFLICT (Pitfall 5 / M35) | 08-03 |
| RESEARCH | Bearer + version auth (Pitfall 6) | 08-01 T3, 08-06 live smoke |
| RESEARCH | photo prefix+suffix (Pitfall 2) | 08-01 T2 |
| RESEARCH | cold-city distinct city_warming (Pitfall 4) | 08-04 T3 |
| RESEARCH | seed_city job mirror + dedup_key | 08-05 |
| RESEARCH | mock-FSQ-client / fixtures (Pitfall 7) | 08-01, 08-04, 08-05 |
| CONTEXT | Area 1 (FSQ integration shape) | 08-01, 08-04 |
| CONTEXT | Area 2 (google_legacy relabel + exclude, curated untouched) | 08-03, 08-04 |
| CONTEXT | Area 3 (pre-seed + cold-start + bounded scope + seeded_at) | 08-04, 08-05 |
| CONTEXT | Area 4 (fail-loud guards + unverified_rate) | 08-02 |
| CONTEXT (Discretion) | endpoint/params, category map, seed cap N, payload, column types | 08-01/03/05 (chosen within secure-by-default) |
| CONTEXT (external blocker) | live FSQ key isolated to the gate | 08-06 (autonomous:false, key-gated) |

**Deferred (correctly NOT planned):** Google display-only photo/map layer; venue freshness/auto-refresh; multi-city as a marketed capability; OSM/Overpass backfill — all in CONTEXT.md Deferred Ideas.

**No MISSING items. No PHASE SPLIT needed** — six plans fit the context budget (Wave 1 three parallel light/medium plans, Wave 2 two medium plans, Wave 3 the gate).
