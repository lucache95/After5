---
phase: 08-compliant-any-city-venue-corpus
plan: 05
subsystem: process-jobs (async city pre-seed) + onboarding trigger
tags: [DATA-02, seed_city, jobs-queue, foursquare, dedup, poison-loop, deno, enqueue_job]
requires:
  - phase: 08
    provides: "foursquare.ts searchPlaces/fsqResultToPlaceRow/passesQualityFloor [08-01]; places.fsq_place_id FULL unique index + cities.seeded_at [08-03]; FSQ_SEED_CATEGORY_IDS + buildWarmRows + onConflict fsq_place_id cold-start [08-04]; canonical jobs queue + enqueue_job(revoked from authenticated) [P2]"
provides:
  - "'seed_city' job_type enum value (migration 20260606150100)"
  - "HANDLERS['seed_city'] — bounded FSQ fetch → quality-floor/dedupe → places upsert onConflict fsq_place_id → cities.seeded_at stamp; fail-loud on missing city_id/key/city"
  - "fsq-seed.ts — SDK-free shared FSQ_SEED_CATEGORY_IDS + buildWarmRows (single source for cold-start AND async seed)"
  - "enqueueSeedCity(cityId) — service-role, uuid-validated, dedup'd (p_dedup_key=city_id), fire-and-forget enqueue helper"
affects:
  - "08-06 (gated prod-apply of the job-type migration + Database type regen for 'seed_city' + live ingestion smoke; wiring enqueueSeedCity once a primary_city_id write site lands)"
tech-stack:
  added: []
  patterns:
    - "injectable handler deps (SeedCityDeps: searchPlaces + getKey) so the seed handler is unit-testable with a mock FSQ client and no live key"
    - "shared SDK-free seed module (fsq-seed.ts) so process-jobs tests dodge the prompt.ts → @anthropic-ai/sdk type-check chain"
    - "fail-loud handler: throw on missing city_id / key / city / all-search-fail → index.ts fail_job backoff retries, dead-letters at attempts>=5"
key-files:
  created:
    - supabase/migrations/20260606150100_data02_seed_city_job_type.sql
    - supabase/functions/process-jobs/seed-city.ts
    - supabase/functions/generate-plan/providers/fsq-seed.ts
    - apps/web/lib/after5/enqueue-seed-city.ts
  modified:
    - supabase/functions/process-jobs/handlers.ts
    - supabase/functions/process-jobs/handlers_test.ts
    - supabase/functions/generate-plan/providers/onthefly.ts
decisions:
  - "job_type is an ENUM (20260525123000) → ALTER TYPE ... ADD VALUE IF NOT EXISTS 'seed_city' (idempotent, replay-safe on db reset; no in-transaction ADD VALUE issue on PG17)"
  - "Extracted FSQ_SEED_CATEGORY_IDS + buildWarmRows from onthefly.ts to a new SDK-free fsq-seed.ts; onthefly re-exports them — cold-start and async seed share ONE source AND the process-jobs test stays SDK-free (onthefly's lazy-import graph would otherwise drag @anthropic-ai/sdk into the type check)"
  - "Handler stamps cities.seeded_at ONLY after a successful fetch+upsert; throws if EVERY category search fails so a never-warmed city is retried, not falsely stamped"
  - "enqueueSeedCity p_type cast to the v1.0 enum literal — generated Database types still enumerate v1.0 job_types; type regen is owned by the gated 08-06. Value is a fixed server-side literal (no injection surface)"
  - "No app-code write site for primary_city_id exists today (RESEARCH Open Q3) — shipped the helper as the ready-to-wire trigger + documented integration rather than fabricate a write path"
metrics:
  duration: ~5 min
  completed: 2026-06-05
  tasks: 3
  files: 7
requirements-completed: [DATA-02]
---

# Phase 8 Plan 05: seed_city Async City Pre-Seed Summary

**Adds the DATA-02 background city warmer: a `seed_city` job type, a `HANDLERS['seed_city']` that runs the same bounded Foursquare fetch → quality-floor/dedupe → `places` upsert (onConflict `fsq_place_id`) as cold-start and stamps `cities.seeded_at`, and a service-role, uuid-validated, dedup'd (`p_dedup_key=city_id`) `enqueueSeedCity` helper — all mirroring the v1.0 job-handler + `enqueue_job` pattern, poison-loop safe, prod untouched.**

## What Was Built

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | `seed_city` job_type enum (migration) | `93784e0` | `20260606150100_data02_seed_city_job_type.sql` |
| 2 | seed_city handler + registration + test | `f761d1e` | `seed-city.ts`, `fsq-seed.ts`, `handlers.ts`, `onthefly.ts`, `handlers_test.ts` |
| 3 | server-side enqueue helper | `c8ef99b` | `apps/web/lib/after5/enqueue-seed-city.ts` |

## How It Works

1. **Trigger (server-side):** `enqueueSeedCity(cityId)` validates the uuid, then `createAdminClient().rpc('enqueue_job', { p_type:'seed_city', p_payload:{ city_id }, p_dedup_key: city_id })`. `enqueue_job` is revoked from `authenticated` (P2 / T-08-11) so this only runs from a service-role server context. `p_dedup_key=city_id` collapses repeated saves / many users in one city to a single pending|running job (T-08-12, poison-loop safe).
2. **Handler (`HANDLERS['seed_city']`):** reads `payload.city_id` (throws if absent), loads the city (`centroid_lat`/`centroid_lng` M1 scalars + `default_radius_km`), runs one bounded `/places/search` per `FSQ_SEED_CATEGORY_IDS` (cap 30/category — not a whole-city crawl, T-08-12), maps via `buildWarmRows` (quality-floor ≥7.0 + dedupe by `fsq_place_id`), upserts `onConflict 'fsq_place_id'` (the 08-03 FULL unique index), then `update cities set seeded_at = now()`.
3. **Failure → retry:** the handler throws on missing city_id / unset key / city-not-found / all-searches-failed / upsert error → `index.ts` `fail_job` backoff, dead-letters at attempts≥5. It never silently completes a no-op seed.

## Verification

- `supabase db reset` replays the full chain through `20260606150100` with no errors; `select 'seed_city'::job_type` resolves and the enum now lists `seed_city`.
- `deno test --no-check supabase/functions/process-jobs/handlers_test.ts` → **5 passed | 0 failed**. New tests: `seed_city` in `ALL_TYPES`; upsert arbiter is `fsq_place_id` + `seeded_at` stamped; quality floor drops the below-floor (rating 5.0) venue before upsert; fail-loud on missing city_id and on city-not-found.
- `deno test --no-check .../providers/onthefly.test.ts` → **9 passed | 0 failed** (refactor to re-export from `fsq-seed.ts` is transparent — buildWarmRows + FSQ_SEED_CATEGORY_IDS tests still green).
- `apps/web` `tsc --noEmit` → clean for `enqueue-seed-city.ts`.
- Plan `<verification>` greps all satisfied: `p_dedup_key` in the helper, `seeded_at` in the handler (5 hits), migration present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] process-jobs test would have inherited the @anthropic-ai/sdk type-check chain**
- **Found during:** Task 2
- **Issue:** Importing `FSQ_SEED_CATEGORY_IDS`/`buildWarmRows` from `onthefly.ts` drags its module graph (`types.ts → ../types.ts → … → prompt.ts → npm:@anthropic-ai/sdk`) into the type check, which is unresolvable under plain `deno test` (no node_modules) — the documented 08-02/08-04 gap.
- **Fix:** Extracted both symbols to a new SDK-free `providers/fsq-seed.ts` (imports only `foursquare.ts → google-places.ts`); `onthefly.ts` now re-exports them (no duplication, plan's "do NOT duplicate the const" honored). The seed handler + test import from `fsq-seed.ts`.
- **Files modified:** `fsq-seed.ts` (new), `onthefly.ts`, `seed-city.ts`
- **Commit:** `f761d1e`

**2. [Rule 3 - Blocking] generated Database types lack the new 'seed_city' enum value**
- **Found during:** Task 3
- **Issue:** `admin.rpc('enqueue_job', { p_type: 'seed_city', … })` failed `tsc` — the generated `@after5/types` `job_type` still enumerates only the v1.0 values (my migration is local-only; type regen is part of the gated 08-06 prod-apply).
- **Fix:** Cast `p_type: 'seed_city' as 'notify'` with a comment explaining the literal is fixed server-side (no injection surface) and that regen lands at 08-06. Avoids prematurely regenerating types against an enum not yet on prod.
- **Files modified:** `apps/web/lib/after5/enqueue-seed-city.ts`
- **Commit:** `c8ef99b`

### Upstream Gap (documented, not auto-fixed)

**Task 3 wiring target absent — no app-code writes `primary_city_id` today (RESEARCH Open Q3).** An exhaustive search (`apps/web` + RPCs in `supabase/migrations`) found zero UPDATE/upsert/insert of `primary_city_id` in application code — it is set only by DB seeds and e2e helpers (`e2e/_helpers/seed.ts`, `route-03-visual.spec.ts`). The plan's Task 3 said "wire a call at the server-side point where primary_city_id is written," but that point does not exist yet. Rather than fabricate a write path, this plan ships `enqueueSeedCity` as the ready-to-wire trigger and documents the single-line integration. **08-06 (or whichever plan lands the profile-location write) must call `enqueueSeedCity(cityId).catch(...)` immediately after the `primary_city_id` write.** The `must_haves` artifact (`enqueue-seed-city.ts` containing `enqueue_job`) and the key_link contract (service-role rpc, dedup by city_id) are satisfied; only the call-site attachment is deferred to where the write lands.

## Known Stubs

None. The handler, enqueue, and migration are fully wired and tested; the only unattached edge is the `primary_city_id` call-site (documented above), which has no current source to attach to.

## Threat Model Compliance

- **T-08-11 (EoP / enqueue_job):** helper uses the service-role client only; `enqueue_job` stays revoked from `authenticated`; `cityId` uuid-validated before the rpc. Satisfied.
- **T-08-12 (DoS / seed_city):** `p_dedup_key=city_id` (one active seed/city); bounded 4-category set × 30/category cap; `fail_job` backoff dead-letters at attempts≥5. Satisfied.
- **T-08-13 (Tampering / SQLi):** parameterized supabase-js queries; `FSQ_SEED_CATEGORY_IDS` is a fixed server-side constant, never user input. Satisfied.

## Notes for 08-06 (gated prod-apply)

- Apply `20260606150100` to prod (`ufufmcpnysvwtutpbian`) — `ALTER TYPE ADD VALUE` is forward-only and idempotent; no relabel/backfill.
- Regenerate `@after5/types` so `job_type` includes `seed_city`, then drop the `as 'notify'` cast in `enqueue-seed-city.ts`.
- Provision `FOURSQUARE_API_KEY` as a Supabase edge secret (BLOCKER for the live ingestion smoke — the handler throws "FOURSQUARE_API_KEY is not configured" without it).
- Wire `enqueueSeedCity(cityId).catch(...)` at the (still-to-land) server-side `primary_city_id` write.
- Re-run the Supabase security advisor after DDL (CLAUDE.md). No RLS change in this migration.

## Self-Check: PASSED
