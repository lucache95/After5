---
phase: 08-compliant-any-city-venue-corpus
plan: 02
subsystem: generate-plan (venue-corpus guard layer)
tags: [DATA-03, fail-loud, guards, unverified, eval-signal, deno, tdd]
requires:
  - generate-plan pipeline (places-filter, scoring, providers/pipeline)
provides:
  - fail-loud withinRadius (null coords EXCLUDE)
  - fail-loud isOpenAt (null hours EXCLUDE for timed slot) + relaxed-mode preserved
  - ItineraryStop.unverified marker
  - sharedLog.unverified_rate eval signal
affects:
  - supabase/functions/generate-plan/places-filter.ts
  - supabase/functions/generate-plan/scoring.ts
  - supabase/functions/generate-plan/types.ts
  - supabase/functions/generate-plan/providers/pipeline.ts
tech-stack:
  added: []
  patterns: [TDD RED→GREEN, pure-util extraction to dodge heavy import chain]
key-files:
  created:
    - supabase/functions/generate-plan/scoring.test.ts
    - supabase/functions/generate-plan/providers/pipeline.test.ts
    - supabase/functions/generate-plan/providers/unverified-rate.ts
  modified:
    - supabase/functions/generate-plan/places-filter.ts
    - supabase/functions/generate-plan/places-filter.test.ts
    - supabase/functions/generate-plan/scoring.ts
    - supabase/functions/generate-plan/types.ts
    - supabase/functions/generate-plan/providers/pipeline.ts
decisions:
  - "isOpenAt reordered relaxed-mode-FIRST then null-hours-exclude (not a naive in-place flip) to preserve relaxed retries for thin/cold cities"
  - "unverified set at stop assembly by re-checking the place's own hours, not by observing isOpenAt's relaxed bypass"
  - "computeUnverifiedRate lives in its own module so its unit test imports stay off the Anthropic-SDK import chain that pipeline.ts pulls"
metrics:
  duration: ~5 min
  completed: 2026-06-05
  tasks: 3
  files_changed: 8
  tests: 11 passing
---

# Phase 8 Plan 02: Fail-Loud Proximity/Hours Guards + Unverified Marker Summary

Inverted the two silent-pass guards (DATA-03): `withinRadius` now EXCLUDES null-coord venues and `isOpenAt` EXCLUDES null-hours venues from timed slots while preserving relaxed-mode retries; threaded an `unverified` stop marker and a per-generation `unverified_rate` eval signal into `sharedLog`.

## What Was Built

**Task 1 — `withinRadius` fail-loud (DATA-03).** Flipped the existing guard test from `true` → `false` for null coords (RED), then changed `places-filter.ts:91` `return true` → `return false` with a rewritten comment. A venue we can't proximity-validate no longer silently passes as in-range. Haversine in/out-of-range cases unchanged.

**Task 2 — `isOpenAt` fail-loud + `unverified` marker.** Exported `isOpenAt` (named export, explicit `: boolean`) for a tight unit test. **Reordered control flow** so relaxed mode (`if (!slotStart) return true`) is checked FIRST, then `if (!p.opens || !p.closes) return false` — per the plan's CRITICAL note this is NOT a naive in-place flip; a naive flip would make relaxed calls return false on null-hours venues and collapse thin/cold-city retries. Added `unverified?: boolean` to `ItineraryStop` and set it at stop assembly in `buildItineraryFromTemplate` by re-checking the admitted place's own hours (`!p.opens || !p.closes`), not by observing the relaxed bypass (invisible to the assembler).

**Task 3 — `unverified_rate` eval signal.** Added a pure exported `computeUnverifiedRate(candidates: Place[]): number` = `(count where lat==null || lng==null || !opens || !closes) / total`, 0 for empty. Placed in its own `providers/unverified-rate.ts` module so the unit test imports it directly without dragging in `prompt.ts` → Anthropic npm SDK (not installed in the local deno env). `runPipeline` sets `sharedLog.unverified_rate` immediately after `candidate_pool_size`, before itinerary assembly, so it is recorded even when assembly later fails.

## Verification

All three test files green together (`deno test --allow-all --no-check`):

```
places-filter.test.ts  1 passed
scoring.test.ts        6 passed
pipeline.test.ts       4 passed
ok | 11 passed | 0 failed
```

Plan-mandated direct proof that relaxed mode survived the reorder:
- `isOpenAt({opens:null,closes:null}, "") === true`  (relaxed mode preserved)
- `isOpenAt({opens:null,closes:null}, "18:00") === false`  (timed slot null-hours excluded)

Plan verification greps:
- `places-filter.ts:91`: `if (typeof lat !== 'number' || typeof lng !== 'number') return false;`
- `pipeline.ts:69`: `sharedLog.unverified_rate = computeUnverifiedRate(candidates);`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `computeUnverifiedRate` placed in a standalone util module rather than directly in `pipeline.ts`.**
- **Found during:** Task 3
- **Issue:** `pipeline.test.ts` importing from `pipeline.ts` transitively imports `prompt.ts`, which imports `npm:@anthropic-ai/sdk@^0.40.0` — not resolvable in the local deno env (no `node_modules`), so the test could not load.
- **Fix:** Created `providers/unverified-rate.ts` exporting the pure helper; `pipeline.ts` imports it and `pipeline.test.ts` imports only the util. The plan explicitly sanctioned this ("add a pure exported helper to pipeline.ts **or a small util it imports**").
- **Files modified:** `providers/unverified-rate.ts` (new), `providers/pipeline.ts`, `providers/pipeline.test.ts`
- **Commits:** d9f9cf3, 869c652

### Out-of-Scope (not fixed)

**Pre-existing `@types/node` / npm-SDK type-resolution failure under `deno test` (no `deno.json`/`node_modules`).** Type-checking the test modules pulls `npm:@types/node` and `npm:@anthropic-ai/sdk` which aren't installed locally. Tests were run with `--no-check` (behavior-level verification, which is what TDD asserts). This is a pre-existing environment/config gap unrelated to this plan's changes — not fixed per the scope boundary. Logged here for the phase-gate plan (08-06) which already owns the local-suite-green gate.

## TDD Gate Compliance

Each task followed RED → GREEN:
- Task 1: `test(08-02)` 081c421 (RED) → `feat(08-02)` 8616854 (GREEN)
- Task 2: `test(08-02)` f19f32d (RED) → `feat(08-02)` e0ff393 (GREEN)
- Task 3: `test(08-02)` d9f9cf3 (RED) → `feat(08-02)` 869c652 (GREEN)

## Known Stubs

None. All guards and signals are wired to live data paths (candidate pool, stop assembly, sharedLog).

## Threat Surface

No new security surface. Matches the plan threat register: T-08-03 (data-integrity spoofing via silent-pass guards) is the mitigation this plan delivers; T-08-04 (`unverified_rate` in sharedLog) is server-side audit only, not client-returned — accepted, unchanged.

## Self-Check: PASSED

All created files exist on disk; all 6 task commits (3 RED + 3 GREEN) present in git history.
