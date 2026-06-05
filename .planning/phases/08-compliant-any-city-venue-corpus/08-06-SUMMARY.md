---
plan: 08-06
phase: 08-compliant-any-city-venue-corpus
status: partial
autonomous: false
requirements: [DATA-01, DATA-02, DATA-03]
tasks_total: 3
tasks_complete: 1
blocked_on: FOURSQUARE_API_KEY (live smoke + prod cutover)
---

# Plan 08-06 Summary — Phase Gate (local-green DONE; prod cutover deferred, key-blocked)

Orchestrator-owned checkpoint. The local-verification half is complete and green; the
key-gated prod cutover + live smoke are deferred (user decision 2026-06-05: "continue into
Phases 9-11, circle back to the Phase 8 cutover when the key lands").

## Task 1 — Local-green gate — DONE (green, against mocks, NO live key)
- `supabase db reset` replayed all migrations incl. the 2 Phase-8 ones (`20260606150000`
  source/fsq_place_id full-unique-index/seeded_at + relabel, `20260606150100` seed_city
  job_type) — clean, no collision.
- **43 Phase-8 deno tests pass** (foursquare 16, scoring/guards, places-filter, pipeline/
  unverified-rate, onthefly 9, process-jobs/seed_city 5) — all fixture/mock-based, runnable
  with no `FOURSQUARE_API_KEY`.
- SQL assertion `supabase/tests/data01_places_fsq_source.sql` → `data01_places_fsq_source OK`
  (columns present, FULL unique index `indpred IS NULL` — M35 trap avoided, both new source
  values accepted, relabel preserves curated).
- `pnpm typecheck` 6/6 packages green (incl. the `enqueue-seed-city.ts` app helper).
- Known env gap (pre-existing, not a regression): the full `deno test generate-plan/` fails on
  the unchanged `prompt.ts → npm:@anthropic-ai/sdk` import without node_modules; Phase-8 files
  run SDK-free. Close under node_modules at cutover.

## Task 2 — Live FSQ ingestion smoke — DEFERRED (blocked on FOURSQUARE_API_KEY)
Verify the `[ASSUMED]` category IDs + `X-Places-Api-Version: 2025-06-17` + a real-city fetch
against the live Foursquare console. Tracked in
`.planning/todos/pending/phase8-prod-cutover-and-preseed-wiring.md`.

## Task 3 — GATED PROD-APPLY — DEFERRED (blocked on FOURSQUARE_API_KEY)
Held as ONE atomic gated op (user decision): 2 migrations + edge-fn deploys (generate-plan,
process-jobs) + `FOURSQUARE_API_KEY` secret + prod advisor + relabel before/after counts +
type regen + live smoke. Prod `ufufmcpnysvwtutpbian` is UNTOUCHED. Tracked in the pending todo.

## Scope decision (user, 2026-06-05)
- **Cold-start only for MVP.** The DATA-02 background pre-seed trigger (`enqueueSeedCity`) is
  built + tested but unwired (no `primary_city_id` write / city-selection flow exists). Deferred
  to Phase 10 (wiring generation into the dating create flow). Cold-start (08-04) delivers the
  functional core: generation warms a cold city on-demand.

## Net: Phase 8 BUILD complete + locally green; prod cutover + background-preseed wiring carried forward.
