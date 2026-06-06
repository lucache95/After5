---
phase: 09-trustworthy-generation-eval-harness
plan: 03
subsystem: testing
tags: [date-quality, eval-harness, unverified-rate, gates, fixtures, vitest, cold-city]

# Dependency graph
requires:
  - phase: 08-on-the-fly-city-generation
    provides: unverified_rate production metric (computeUnverifiedRate) + the cold-city vacuous-green risk this plan closes
provides:
  - scheduleMonotonic critical gate (strictly-increasing starts + no-overlap with travel)
  - unverified_rate as a first-class per-fixture scored signal mirroring production verbatim
  - UNVERIFIED_RATE_THRESHOLD + 'unverified_rate' Regression kind (absolute, baseline-independent)
  - per-city unverified_rate grouping on EvalReport
  - coldcity-v0 golden set (2 thin Foursquare-cold proxies + 1 usable cold city)
affects: [09-04 baseline regeneration, eval CI gate, on-the-fly city generation quality]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Eval-metric/production-metric parity: copy the predicate verbatim and assert equality in a test"
    - "Absolute (not baseline-diff) regression for data-thinness so a new market cannot read green vacuously"
    - "City key derived from fixture_id prefix (segment before first hyphen)"

key-files:
  created:
    - packages/date-quality/fixtures/dategen/coldcity-v0/coldcity-thin-01.json
    - packages/date-quality/fixtures/dategen/coldcity-v0/coldcity-thin-02.json
    - packages/date-quality/fixtures/dategen/coldcity-v0/coldcity-usable-01.json
  modified:
    - packages/date-quality/src/gates.ts
    - packages/date-quality/src/runEval.ts
    - packages/date-quality/src/index.ts
    - packages/date-quality/src/__tests__/gates.test.ts
    - packages/date-quality/src/__tests__/runEval.test.ts

key-decisions:
  - "UNVERIFIED_RATE_THRESHOLD = 1/3: one of three stops may be a thin pick; half-or-more thin is a failure"
  - "unverified_rate regression is ABSOLUTE (any fixture over threshold), not a baseline diff — a thin cold city fails outright even on first run"
  - "scheduleMonotonic degrades to a pure end-before-next-start check when stops lack coords (drive term added only when both coords present)"
  - "City key = fixture_id prefix before first hyphen (reuses existing naming, no schema change)"

patterns-established:
  - "Eval/production metric parity asserted by importing the production module into the test"
  - "Data-thinness is a scored signal, not something gates skip"

requirements-completed: [EVAL-01]

# Metrics
duration: ~20min
completed: 2026-06-05
---

# Phase 9 Plan 03: EVAL-01 — scheduleMonotonic gate + cold-city fixtures + unverified_rate scored signal Summary

**Closed the cold-city vacuous-green hole: unverified_rate is now a first-class scored signal that fails a thin cold city outright, plus a scheduleMonotonic critical gate and a coldcity-v0 golden set.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-05T17:02Z
- **Completed:** 2026-06-05T17:20Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 5 modified, 3 created

## Accomplishments
- `scheduleMonotonic` critical gate: stop start times must strictly increase AND `start_time[i] + duration_min[i] + drive(i→i+1) ≤ start_time[i+1]`. Catches time-travel and overlap; reuses `parseTime` + the haversine/`AVG_KMH` drive estimate from `travelPacing`; skips only on unparseable times. Registered in `GATES` (now 19 single-date gates) and exported via `index.ts`.
- `unverified_rate` is now a per-fixture scored signal on `FixtureResult`, computed with the **verbatim** production predicate (`lat == null || lng == null || !opens || !closes`, falsy on hours). A parity test imports the real `computeUnverifiedRate` from `supabase/functions/generate-plan/providers/unverified-rate.ts` and asserts equality.
- `UNVERIFIED_RATE_THRESHOLD = 1/3` + a `'unverified_rate'` `Regression` kind emitted in `compareToBaseline` as an **absolute** check — a thin cold city FAILS the suite rather than reading green by leaning on the null-skipping gates (T-09-06 / RESEARCH Pitfall 1).
- Per-city grouping (`EvalReport.cities`) surfaces the mean unverified_rate per city (city = fixture_id prefix).
- `coldcity-v0` golden set: 2 deliberately-thin Foursquare-cold proxies (`coldcity-thin-01` ≈ 0.67, `coldcity-thin-02` = 0.5) + 1 usable cold city (`coldcity-usable-01` = 0) so the threshold has a passing case. An on-disk integration test loads all three and asserts thin-fails / usable-clears.

## Task Commits

Each task was committed atomically (TDD: test+impl folded into one task commit each since the gate/symbol needed to exist for the test to compile):

1. **Task 1: scheduleMonotonic critical gate** — `c2cf285` (feat)
2. **Task 2: cold-city fixtures + unverified_rate scored signal** — `bdf69b9` (feat)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `packages/date-quality/src/gates.ts` — `scheduleMonotonic` gate + `minutesToHHMM` helper; registered in `GATES`
- `packages/date-quality/src/runEval.ts` — `computeUnverifiedRate`, `cityOf`, `UNVERIFIED_RATE_THRESHOLD`; `unverified_rate` on `FixtureResult`; `cities` on `EvalReport`; `'unverified_rate'` Regression in `compareToBaseline`
- `packages/date-quality/src/index.ts` — export new symbols (`scheduleMonotonic`, `computeUnverifiedRate`, `cityOf`, `UNVERIFIED_RATE_THRESHOLD`)
- `packages/date-quality/src/__tests__/gates.test.ts` — scheduleMonotonic tests; updated GATES count (19/20)
- `packages/date-quality/src/__tests__/runEval.test.ts` — parity, scored-signal, per-city, and on-disk cold-city integration tests
- `packages/date-quality/fixtures/dategen/coldcity-v0/coldcity-thin-01.json` — thin proxy (2/3 null)
- `packages/date-quality/fixtures/dategen/coldcity-v0/coldcity-thin-02.json` — thin boundary (1/2 null)
- `packages/date-quality/fixtures/dategen/coldcity-v0/coldcity-usable-01.json` — usable cold city (0 null)

## Decisions Made
- **Threshold 1/3:** a genuinely usable cold city carries coords + hours for the large majority of picks; half-or-more thin is a failure. Discretion exercised per Open Question 2.
- **Absolute regression check** for unverified_rate (not the "newly fails vs baseline" pattern the other regression kinds use): the must-have requires a thin cold city to fail outright, including on a first run with an empty baseline.
- **scheduleMonotonic drive term is conditional:** added only when both adjacent stops carry coords; otherwise the gate still enforces end-before-next-start so it never silently passes a present-but-wrong schedule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated three pre-existing tests whose fixtures the new gate/threshold legitimately flagged**
- **Found during:** Tasks 1 and 2
- **Issue:** (a) `gradeFixture > runs the judge when no critical gate fails` used two stops both defaulting to `start_time: '18:00'` — equal starts correctly trip the new strictly-increasing `scheduleMonotonic` gate, suppressing the judge. (b) `runEval (dry mode) > reports no regressions against an identical baseline` used fixtures whose stops had no coords/hours → `unverified_rate = 1.0` → correctly flags an unverified_rate regression even against an identical baseline.
- **Fix:** Gave the affected test fixtures distinct, ordered start times and full coords/hours so they represent valid warm-city cases. The new gate/threshold behavior is correct; the old fixtures were unintentionally invalid under the stricter checks.
- **Files modified:** `packages/date-quality/src/__tests__/runEval.test.ts`
- **Verification:** Full suite 73/73 green; typecheck clean.
- **Committed in:** `c2cf285` (Task 1) and `bdf69b9` (Task 2)

**2. [Rule 3 - Blocking] Test-literal typecheck fixes**
- **Found during:** Task 2
- **Issue:** New `EvalReport` test literals omitted the now-required `cities` field; `cities.coldcity`/`cities.kelowna` are `number | undefined` under `strict`.
- **Fix:** Added `cities` to the literals and `?? 0` guards on the optional accesses.
- **Files modified:** `packages/date-quality/src/__tests__/runEval.test.ts`
- **Verification:** `tsc --noEmit` clean.
- **Committed in:** `bdf69b9`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). All necessary for correctness/compilation. No scope creep — every change is downstream of the two planned features.
**Impact on plan:** None on scope. The new gate and threshold are strictly correct; the deviations only realign tests/fixtures to the stricter, intended behavior.

## Issues Encountered
- The eval/production parity test imports a Deno-style module (`unverified-rate.ts`, with a `.ts`-extension type-only import). It resolved cleanly under the package's vitest/esbuild config — no shim needed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 09-04 must **regenerate the baseline** (deferred here by design) so the new `scheduleMonotonic` gate, `unverified_rate` field, `cities` map, and the coldcity-v0 fixtures are all captured in one baseline after the judge param + CI land.
- The cold-city anti-vacuous-green guard is now enforced and tested; a new on-the-fly market that collapses to mostly-null data will fail the suite.

## Self-Check: PASSED

---
*Phase: 09-trustworthy-generation-eval-harness*
*Completed: 2026-06-05*
