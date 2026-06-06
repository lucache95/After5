---
phase: 09-trustworthy-generation-eval-harness
plan: 04
subsystem: testing
tags: [date-quality, eval-harness, llm-judge, ci-gate, github-actions, no-hallucination, cold-city]

# Dependency graph
requires:
  - phase: 09-trustworthy-generation-eval-harness
    provides: "09-03 — scheduleMonotonic critical gate, unverified_rate scored signal + absolute threshold, cities map, coldcity-v0 golden set, deferred baseline regen"
provides:
  - "Per-fixture JUDGE_CITY: the Opus-4.8 judge grades each fixture against its OWN locale (Kelowna for kelowna-*, Cranbrook for coldcity-*), not a hard-coded Kelowna"
  - "buildSystemPrompt(city) + cityForFixture(fixture) + judgeCity option threaded through judge()/buildJudgeUserMessage()"
  - "Live noHallucinatedVenue resolution: every emitted place_id resolves against a pinned offline places.snapshot.json per city dir; an absent id is a CRITICAL failure"
  - "Regenerated baseline-v0.json (gate-v0 suite) covering scheduleMonotonic + unverified_rate + cities map + the usable cold city"
  - ".github/workflows/eval.yml — keyless DRY deterministic HARD gate + advisory live judge job that never blocks merge"
affects: [10-generation-primary-path, 11-ux-nav-audit, eval CI on generate-plan changes]

# Tech tracking
tech-stack:
  added: ["GitHub Actions workflow (.github/workflows/eval.yml)"]
  patterns:
    - "Per-fixture locale: judge city derived from fixture-id prefix (kelowna->Kelowna,BC / coldcity->Cranbrook,BC), defaulting to JUDGE_CITY"
    - "Anti-fabrication lives in the LIVE runner (script layer), not the pure gate set — dry mode writes over frozen ids and cannot hallucinate"
    - "Offline pinned JSON snapshot for venue resolution keeps the eval reproducible + keyless"
    - "CI split: deterministic eval is the only HARD gate (keyless); the LLM judge is advisory (continue-on-error, secret-gated, never blocks merge)"
    - "Gating suite excludes data-thin negatives (unverified_rate > threshold); those are asserted-to-fail in the unit suite instead"

key-files:
  created:
    - .github/workflows/eval.yml
    - packages/date-quality/fixtures/dategen/kelowna-v0/places.snapshot.json
    - packages/date-quality/fixtures/dategen/coldcity-v0/places.snapshot.json
    - packages/date-quality/src/__tests__/judge.test.ts
    - packages/date-quality/src/__tests__/no-hallucinated-venue.test.ts
  modified:
    - packages/date-quality/src/judge.ts
    - packages/date-quality/scripts/eval-dategen.ts
    - packages/date-quality/src/runEval.ts
    - packages/date-quality/src/index.ts
    - packages/date-quality/baselines/dategen/baseline-v0.json

key-decisions:
  - "coldcity locale = Cranbrook, BC (the coldcity fixtures author real Cranbrook venues: Heid Out, Fisher Peak, Allegra)"
  - "Gating suite (gate-v0) = all kelowna + cold-city fixtures EXCEPT those whose unverified_rate exceeds the absolute threshold; the thin negatives (coldcity-thin-*, kelowna-adversarial-05) stay in the unit suite where they are asserted to FAIL"
  - "noHallucinatedVenue is live-mode only and lives in the script/runner layer, NOT in GATES (dry mode cannot hallucinate)"
  - "places.snapshot.json is a reserved file name skipped by loadFixtures so a snapshot never loads as a fixture"
  - "Deterministic eval is the only HARD CI gate (keyless, exit 1 on regression); the Opus judge job is advisory via continue-on-error + secret gating (CONTEXT Area 3: deterministic hard-fail, judge advisory; T-09-08/09/10)"

patterns-established:
  - "Per-fixture judge locale via cityForFixture"
  - "Live anti-fabrication snapshot resolution in the runner layer"
  - "Hard-vs-advisory CI gate split for deterministic vs LLM checks"

requirements-completed: [EVAL-01]

# Metrics
duration: ~25min
completed: 2026-06-05
---

# Phase 9 Plan 04: EVAL-01 — per-fixture judge locale + live no-hallucination + CI gate Summary

**Closed out EVAL-01: the Opus-4.8 judge now grades each fixture against its own city, the live runner resolves every emitted place_id against a pinned offline snapshot (a fabricated venue is a critical fail), the baseline is regenerated to cover the 09-03 gates/fixtures, and a net-new CI workflow runs the deterministic eval as a hard keyless gate with the LLM judge advisory-only.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-05T17:12Z
- **Completed:** 2026-06-05T17:20Z
- **Tasks:** 2 (Task 1 TDD)
- **Files modified:** 5 modified, 5 created

## Accomplishments

- **Per-fixture JUDGE_CITY.** `SYSTEM_PROMPT` became `buildSystemPrompt(city)` and `buildJudgeUserMessage`/`judge` take a `judgeCity`. `cityForFixture(fixture)` derives the locale from the fixture-id prefix (`kelowna` → Kelowna, BC; `coldcity` → Cranbrook, BC) and defaults to `JUDGE_CITY`. A cold-city fixture is now judged for fit to its own city — the system + user prompts name that city and never say Kelowna. `JUDGE_CITY` is retained as the Kelowna default and `SYSTEM_PROMPT` as a back-compat constant.
- **Live `noHallucinatedVenue`.** Added to the live runner (`scripts/eval-dategen.ts`), not GATES: a pure resolver flags every emitted `place_id` absent from a pinned `places.snapshot.json` as a CRITICAL failure, plus `loadPlacesSnapshot` (offline JSON load) and `resolveLiveVenues`. Wired into the CLI `--live` path; it forces a nonzero exit when a venue is fabricated. Dry mode is a no-op (the house writer only writes over frozen ids). All 85 fixture place_ids resolve in the committed snapshots, so legitimate runs pass.
- **Regenerated baseline (`gate-v0` suite).** The CLI now loads kelowna-v0 + coldcity-v0 and gates on the subset whose `unverified_rate` is within the 09-03 absolute threshold (29 kelowna + the usable cold city = 30 fixtures). The fresh `baseline-v0.json` captures the new `scheduleMonotonic` gate (several kelowna fixtures now legitimately cap at 40), the per-fixture `unverified_rate` field, and the per-city `cities` map (`{kelowna, coldcity}`). Dry eval exits 0 against it.
- **Net-new CI gate (`.github/workflows/eval.yml`).** `eval-dry` job: keyless deterministic typecheck + tests + `pnpm --filter @after5/date-quality eval` — the only HARD gate, fails the merge on regression. `eval-live-judge` job: `continue-on-error: true`, secret-gated (`ANTHROPIC_API_KEY`), same-repo-only, runs `eval -- --live` advisory and warns (never blocks). Triggers on `supabase/functions/generate-plan/**` + `packages/date-quality/**`. Node 22 / pnpm 9.12.0, mirroring `5b-tests.yml`.

## Task Commits

1. **Task 1 (TDD): per-fixture JUDGE_CITY + live noHallucinatedVenue** — `5edf6fd` (feat)
2. **Task 2: regenerate baseline + wire the CI gate** — `0869634` (feat)

Plan metadata: see final docs commit.

## Files Created/Modified

- `packages/date-quality/src/judge.ts` — `buildSystemPrompt(city)`, `cityForFixture(fixture)`, `CITY_LOCALES`, `judgeCity` option threaded into `judge`/`buildJudgeUserMessage`; `SYSTEM_PROMPT`/`JUDGE_CITY` kept as Kelowna defaults
- `packages/date-quality/scripts/eval-dategen.ts` — `noHallucinatedVenue`, `loadPlacesSnapshot`, `resolveLiveVenues`; `gate-v0` suite loader excluding data-thin negatives; live-mode hallucination check wired to the exit code
- `packages/date-quality/src/runEval.ts` — `loadFixtures` skips the reserved `PLACES_SNAPSHOT_FILE`
- `packages/date-quality/src/index.ts` — export `buildSystemPrompt`, `cityForFixture`
- `packages/date-quality/baselines/dategen/baseline-v0.json` — regenerated (gate-v0, 30 fixtures, cities map, unverified_rate, scheduleMonotonic captured)
- `.github/workflows/eval.yml` — hard dry gate + advisory live judge
- `packages/date-quality/fixtures/dategen/{kelowna-v0,coldcity-v0}/places.snapshot.json` — pinned offline venue snapshots
- `packages/date-quality/src/__tests__/judge.test.ts` — per-fixture city threading + strict parse
- `packages/date-quality/src/__tests__/no-hallucinated-venue.test.ts` — pure resolver: passes when all ids resolve, critical-fails on a fabricated id

## Decisions Made

- **Cold-city locale = Cranbrook, BC** — the coldcity fixtures use real Cranbrook venues, so judging them there (not Kelowna) is the faithful locale.
- **Gate-v0 suite excludes data-thin negatives** — 09-03's `unverified_rate` regression is ABSOLUTE, so a fixture over the threshold fails forever. `coldcity-thin-*` and the pre-existing `kelowna-adversarial-05` (all-null geo/hours) are anti-vacuous-green NEGATIVES; they stay in the unit suite (asserted to fail) and out of the green CI gate. The usable cold city stays in so the baseline `cities` map is cold-city-aware.
- **Deterministic = hard, judge = advisory** — the dry eval is keyless and blocks merges on regression; the Opus judge job is `continue-on-error` + secret-gated so a flaky judge (or a fork PR with no key) can never DoS a merge (CONTEXT Area 3; threat register T-09-08/09/10).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing `kelowna-adversarial-05` trips the new absolute unverified_rate threshold**
- **Found during:** Task 2 (first dry run against the fresh baseline)
- **Issue:** 09-03 made `unverified_rate` an ABSOLUTE regression. `kelowna-adversarial-05-sparse-venue-metadata` has all-null geo/hours (unverified_rate = 1.0) by design, so it flagged a regression and the dry gate could never go green.
- **Fix:** The gating suite (`loadGateFixtures`) excludes any fixture whose `unverified_rate` exceeds `UNVERIFIED_RATE_THRESHOLD` — the same category as `coldcity-thin-*`. These data-thin negatives remain asserted-to-fail in `runEval.test.ts`.
- **Files modified:** `packages/date-quality/scripts/eval-dategen.ts`
- **Committed in:** `0869634`

**2. [Rule 3 - Blocking] The new places.snapshot.json loaded as a (malformed) fixture**
- **Found during:** Task 2 (the cold-city on-disk integration test expected 3 files, got 4)
- **Issue:** `loadFixtures` globs `*.json`, so the snapshot co-located in the fixture dir was read as a fixture.
- **Fix:** Added `PLACES_SNAPSHOT_FILE` and skipped it in `loadFixtures`. Keeps the snapshot per-city-dir as the plan specifies.
- **Files modified:** `packages/date-quality/src/runEval.ts`
- **Committed in:** `0869634`

**3. [Rule 3 - Minor] `.github/workflows/` already existed**
- **Issue:** The plan called the directory net-new; it already holds `5b-tests.yml`.
- **Fix:** Added `eval.yml` alongside it (mirroring its Node 22 / pnpm 9.12.0 setup). No conflict.

**Total deviations:** 3 auto-fixed (all blocking/minor). All necessary for a green keyless gate; no scope creep.

## Issues Encountered

- `--live` mode still needs real LLM wiring (writing pass + Opus judge adapter) to produce judge scores; that adapter is intentionally out of scope here (CONTEXT: judge advisory). The live job's value today is the `noHallucinatedVenue` resolution and the advisory hook; the judge LLM adapter wiring is a follow-up if/when the advisory job is exercised with a key.

## User Setup Required

- For the advisory live judge job to run in CI, set an `ANTHROPIC_API_KEY` repository secret. Absent it, the advisory job warns and exits 0 — it never blocks a merge.

## Verification

- `pnpm --filter @after5/date-quality typecheck` clean.
- `pnpm --filter @after5/date-quality test` — 90/90 green (5 files).
- `pnpm --filter @after5/date-quality eval` exits 0 against the regenerated baseline (PASS: no regressions).
- `.github/workflows/eval.yml` present; YAML valid; both jobs structurally complete.

## Next Phase Readiness

- EVAL-01 is closed: the harness gates in CI exactly as CONTEXT locks (deterministic hard-fail, judge advisory), the cold-city judge reasons about its own locale, and a fabricated venue fails the live check.
- Phase 9 remaining requirements: PLAN-01, PLAN-02, SOUND-01.

## Self-Check: PASSED

---
*Phase: 09-trustworthy-generation-eval-harness*
*Completed: 2026-06-05*
