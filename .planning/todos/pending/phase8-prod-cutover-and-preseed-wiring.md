---
created: 2026-06-05
title: Phase 8 prod cutover (Foursquare key-gated) + pre-seed trigger wiring
area: venue-corpus / generate-plan / deployment
resolves_phase: 10
files:
  - supabase/functions/generate-plan/
  - supabase/functions/process-jobs/seed-city.ts
  - supabase/migrations/20260606150000_data01_places_fsq_source.sql
  - supabase/migrations/20260606150100_data02_seed_city_job_type.sql
  - apps/web/lib/after5/enqueue-seed-city.ts
---

## Problem

Phase 8 (Compliant Any-City Venue Corpus) is **built + locally green** but two completion
steps are deferred:

1. **Prod cutover is key-blocked (08-06).** Needs `FOURSQUARE_API_KEY`. Hold as ONE atomic
   gated operation (user decision 2026-06-05): apply the 2 schema migrations
   (`20260606150000` source/fsq_place_id/seeded_at + relabel, `20260606150100` seed_city
   job_type) + deploy the updated `generate-plan` + `process-jobs` edge fns + set the
   `FOURSQUARE_API_KEY` edge secret on prod `ufufmcpnysvwtutpbian` — all together, behind the
   human gate. Then: prod advisor (no new findings), the relabel before/after source counts,
   regen Database types (the `seed_city` enum value + fsq columns — removes the executor's
   `as 'notify'` cast), and the live FSQ smoke (verify the `[ASSUMED]` category IDs + the
   `X-Places-Api-Version: 2025-06-17` against the live console; re-verify Foursquare free-tier).

2. **Background pre-seed trigger is unwired (deferred to Phase 10 per user decision).**
   `enqueueSeedCity(cityId)` is built + tested but nothing calls it — no production flow writes
   `primary_city_id` (only test seeds do), and there's no city-selection UX. MVP ships
   **cold-start-only** (08-04 warms on-demand at generation). When Phase 10 wires generation
   into the dating create flow, add the city-selection step + `primary_city_id` write + the
   `enqueueSeedCity` call-site (fire-and-forget after the location write).

## Status of Phase 8 requirements
- DATA-01 (Foursquare corpus, Google removed): built + local-green; prod cutover pending key.
- DATA-03 (fail-loud guards + unverified_rate): built + local-green (43 deno tests).
- DATA-02 (pre-seed + cold-start): cold-start built + local-green; background pre-seed built
  but unwired → Phase 10. Cold-start delivers the MVP functional core.

## Known env gap (not a regression)
The full `deno test` over generate-plan/ fails locally because `prompt.ts` imports
`npm:@anthropic-ai/sdk` (unresolved without node_modules) — pre-existing, affects the
unchanged `railway`/`select`/`prompt` test files. Phase-8 test files run SDK-free (43 pass).
The 08-06 gate should run the full suite under `node_modules` (or `deno install` / set
`nodeModulesDir: auto`) to close this.

## UPDATE 2026-06-05 — Phase 9 bundles into this cutover
Phase 9 (Trustworthy Generation + Eval Harness) is build-complete + locally green but its
prod-bound steps SHIP WITH this Phase-8 cutover (the `generate-plan` edge deploy carries both
phases' code). Add to the atomic gated op:
- apply migration `20260606160000_sound01_ambient_loops_seed` (8 ambient rows)
- deploy updated `generate-plan` (tool-use copy pass + haversine hop-gate + improve.ts) + `process-jobs`
- generate + upload the 8 new ambient audio loops (ElevenLabs recipe → `docs/superpowers/SOUND-GENERATION.md`; service_role JWT to `ambient-sounds` bucket) — needs the ElevenLabs key
- @420px visual-verify of the live improve-loop UI (ImproveControls in /create)
- optional: set `ANTHROPIC_API_KEY` repo secret to enable the advisory live-judge CI job
