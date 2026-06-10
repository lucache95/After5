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

## Known env gap — CLOSED (2026-06-09)
Run the full generate-plan deno suite with `--node-modules-dir=none` (resolves
`npm:@anthropic-ai/sdk` from deno's global cache): 96/96 pass.
**WARNING: never use `--node-modules-dir=auto` in this repo** — it drops a `.deno` dir into
pnpm's root `node_modules`, which silently breaks vitest's jest-dom setup repo-wide
(hundreds of `Invalid Chai property: toBeInTheDocument` failures). If it happens:
`rm -rf node_modules/.deno && pnpm install --frozen-lockfile`.

## UPDATE 2026-06-05 — Phase 9 bundles into this cutover
Phase 9 (Trustworthy Generation + Eval Harness) is build-complete + locally green but its
prod-bound steps SHIP WITH this Phase-8 cutover (the `generate-plan` edge deploy carries both
phases' code). Add to the atomic gated op:
- apply migration `20260606160000_sound01_ambient_loops_seed` (8 ambient rows)
- deploy updated `generate-plan` (tool-use copy pass + haversine hop-gate + improve.ts) + `process-jobs`
- generate + upload the 8 new ambient audio loops (ElevenLabs recipe → `docs/superpowers/SOUND-GENERATION.md`; service_role JWT to `ambient-sounds` bucket) — needs the ElevenLabs key
- @420px visual-verify of the live improve-loop UI (ImproveControls in /create)
- optional: set `ANTHROPIC_API_KEY` repo secret to enable the advisory live-judge CI job

## UPDATE 2026-06-08 — cutover APPLIED; two items remain
**Applied to prod `ufufmcpnysvwtutpbian` (gated, verified):** `FOURSQUARE_API_KEY` edge secret set
+ validated live (HTTP 200). Migrations `20260606150000` (places fsq source + relabel) and
`20260606150100` (seed_city job_type) applied — relabel moved 92 `discovered`→`google_legacy`,
removed **0** active+live venues (59 curated intact). `generate-plan` + `process-jobs` redeployed.
Security advisor: no new findings. Then a follow-up commit (5aa3eb3) fixed three any-city
integration-seam bugs found by the smoke (env.foursquareKey unwired; city_slug='kelowna' default
shadowing city_query; open-city geocode still on Google → swapped to Foursquare). Verified: typed
"Kelowna" → curated; "Portland" → reaches the FSQ open-city + warm path.

**STILL OPEN:**
1. **Cold-city warm writes 0 rows → `city_warming` 503.** Root cause isolated: `passesQualityFloor`
   (`foursquare.ts:106`) requires `rating >= 7.0` AND rating present; sparse-rating FSQ cold-city
   results all fail it → empty corpus. Fix = an evidence-based relax (e.g. accept null-rating
   venues gated on popularity, or lower the floor) tuned against the date-quality eval harness +
   re-smoke a cold city. NOTE: FSQ free-tier rate-limits (429) under burst testing — pace the
   diagnostic calls. Also cosmetic: `foursquare.ts geocodeCity` returns the top venue's name as the
   city display name ("128 SW 3rd Ave…" instead of "Portland") — fix to read a locality field.
2. **Ambient audio (SOUND-01)** — migration `20260606160000` + the 8 ElevenLabs loops still
   DEFERRED (no `ELEVENLABS_API_KEY`). Hold the seed migration with the audio.
