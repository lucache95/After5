---
phase: 07-enhancements-and-polish-p3
plan: 01
subsystem: database
tags: [postgres, rpc, supabase, security-definer, feed-contract, mapbox, typescript]

# Dependency graph
requires:
  - phase: 06-trust-and-safety-p2
    provides: "latest migration 20260606130200 (the timestamp this plan's migration must sort after)"
  - phase: 05-progressive-reveal-p2
    provides: "the e15 host-hint feed contract + browse_feed_for_viewer body that E22/E23 build on (downstream plans)"
provides:
  - "get_night_detail re-CREATE: each stop carries lat/lng/place_slug (catalog) or null (non-catalog, graceful degrade)"
  - "NightDetailStop.place_slug + normalizer support (consumed by E20 map + E21 venue links)"
  - "FeedNight.city_name (consumed by E23 city label)"
  - "withdrawInterest wrapper (consumed by E24 standby/withdraw)"
  - "the single consolidated feed.ts Phase-7 contract so Wave-1 DB plans + Wave-2/3 frontend plans never collide on feed.ts"
affects: [07-02, 07-03, 07-04, E20-map, E21-venue-links, E22-ranking, E23-city-label, E24-standby]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CREATE OR REPLACE RPC widening: keep RETURNS TABLE byte-identical, widen only jsonb element contents"
    - "left join places on (s->>'place_id')::uuid inside the DEFINER RPC (coords never via a client-side places query — T-07-01)"
    - "forward-reference RPC-name cast for a not-yet-applied DEFINER RPC (types regenerate at gated prod-apply)"

key-files:
  created:
    - supabase/migrations/20260606140000_e20_get_night_detail_coords.sql
    - supabase/tests/e20_night_detail_coords.sql
  modified:
    - packages/api-client/src/feed.ts

key-decisions:
  - "Coords merged INSIDE the get_night_detail DEFINER RPC, never a client-side places query (T-07-01 host-correlation mitigation)"
  - "Non-catalog place_id degrades to null lat/lng/place_slug via left join — no row error (D-01 graceful degrade)"
  - "All feed.ts Phase-7 type/wrapper additions owned here in one place to keep Wave 1 parallel (place_slug + city_name + withdrawInterest)"

patterns-established:
  - "RPC widening via CREATE OR REPLACE preserving the RETURNS TABLE shape; re-emit the revoke-anon/grant-authenticated tail for safety"
  - "Migration timestamp strictly after the latest applied prefix (Phase-6 ordering lesson) so db reset replays it last"

requirements-completed: [REQ-E20, REQ-E23, REQ-E24]

# Metrics
duration: ~22min
completed: 2026-06-05
---

# Phase 7 Plan 01: Phase-7 Data Contract Summary

**get_night_detail now merges per-stop lat/lng/place_slug from the catalog (null-degrading for non-catalog stops) and feed.ts carries the consolidated Phase-7 contract: place_slug on NightDetailStop, city_name on FeedNight, and a withdrawInterest wrapper.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-06-05T17:10:40Z (approx)
- **Completed:** 2026-06-05
- **Tasks:** 2
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments
- `get_night_detail` re-CREATEd (CREATE OR REPLACE) so each stop carries `lat`/`lng`/`place_slug` from `places` by `place_id`; a non-catalog `place_id` degrades to null with no row error (D-01). Reservation_url scrub, search_path pin, and authenticated-only privileges all preserved (m5 blind contract intact).
- The single consolidated feed.ts Phase-7 contract: `place_slug` on `NightDetailStop` (+ normalizer reads `o.place_slug`), `city_name` on `FeedNight`, and a new `withdrawInterest(client, { instance_id })` wrapper mirroring `cancelNight`/`updateNight`.
- A self-contained SQL test (`e20_night_detail_coords.sql`) proving catalog→coords, non-catalog→null-no-error, reservation_url scrubbed, and the anon-denied/authenticated-granted privilege boundary. Verified passing on a fresh `supabase db reset` (migration replays last).

## Task Commits

Each task was committed atomically:

1. **Task 1: feed.ts Phase-7 contract (place_slug, city_name, withdrawInterest)** - `91da323` (feat)
2. **Task 2 (TDD RED): failing e20 night-detail coords assertion** - `e6dabc9` (test)
3. **Task 2 (TDD GREEN): get_night_detail merges per-stop lat/lng/place_slug** - `f12b803` (feat)

_Task 2 was tdd="true": test committed failing (RED), migration made it pass (GREEN). No refactor needed._

## Files Created/Modified
- `supabase/migrations/20260606140000_e20_get_night_detail_coords.sql` - CREATE OR REPLACE get_night_detail; left joins `places` to merge lat/lng/place_slug per stop, keeps the reservation_url scrub + privilege tail.
- `supabase/tests/e20_night_detail_coords.sql` - catalog/non-catalog stop coord assertions + scrub + anon/authenticated privilege checks.
- `packages/api-client/src/feed.ts` - `place_slug` on NightDetailStop (+ normalizer), `city_name` on FeedNight, `withdrawInterest` wrapper.

## Decisions Made
- Coords added inside the DEFINER RPC (never a client-side `places` query) — mitigates T-07-01 (a client-side query could correlate a stop to a host).
- Non-catalog stops degrade to null via the LEFT join (D-01) rather than erroring or being dropped — the element stays present with null coords.
- Owned ALL feed.ts Phase-7 additions in this plan (per the objective) so the parallel Wave-1 DB plans and Wave-2/3 frontend plans never collide on feed.ts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 verify command referenced a nonexistent `build` script**
- **Found during:** Task 1 (feed.ts contract)
- **Issue:** The plan's `<automated>` verify was `pnpm --filter @after5/api-client build && pnpm typecheck`, but `@after5/api-client` has no `build` script (`None of the selected packages has a "build" script`). The package's real correctness gate is `typecheck` (`tsc --noEmit`).
- **Fix:** Ran `pnpm --filter @after5/api-client typecheck && pnpm typecheck` (the package's actual type-check gate + the full-workspace typecheck). Both pass.
- **Files modified:** none (verification-command substitution only)
- **Verification:** `pnpm typecheck` exits 0 across all 6 packages.
- **Committed in:** n/a (no code change)

**2. [Rule 3 - Blocking] withdraw_interest RPC name not yet in generated Database types**
- **Found during:** Task 1 (withdrawInterest wrapper)
- **Issue:** `withdraw_interest` is added by this plan's migration, which is gated (not applied to prod, types not regenerated), so `client.rpc('withdraw_interest', ...)` failed typecheck — the RPC-name string is typed against the known RPC union (the existing `as never` on the args object only covers the args, not the name).
- **Fix:** Cast `client.rpc` through a narrow local function type for the name+args (forward-reference pattern; types regenerate at the gated prod-apply). Also reworded the wrapper's JSDoc to drop backticks/em-dash that tripped the TS lexer inside the block comment.
- **Files modified:** packages/api-client/src/feed.ts
- **Verification:** `pnpm typecheck` exits 0.
- **Committed in:** `91da323` (Task 1 commit)

**3. [Rule 1 - Bug] e20 test fixture missing profiles_private birthdate (age gate)**
- **Found during:** Task 2 (e20 SQL test, RED run)
- **Issue:** Setting `dating_enabled=true` fires the `enforce_age_gate` trigger, which requires a birthdate in `profiles_private`. The first RED run errored on the host setup before reaching the behavior assertion.
- **Fix:** Insert `profiles_private(user_id, birthdate)` for the host + viewer (mirrors the e13 test harness) before enabling dating.
- **Files modified:** supabase/tests/e20_night_detail_coords.sql
- **Verification:** RED then failed on the intended case-1 coord assertion (the behavior under test), confirming the fixture fix was correct; GREEN passes all 4 cases.
- **Committed in:** `e6dabc9` (Task 2 RED commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug). All in test/build-harness scope.
**Impact on plan:** No scope creep — all three were verification/fixture blockers, not changes to the shipped contract. The migration body and feed.ts type/wrapper shape match the plan + 07-PATTERNS assignments exactly.

## Issues Encountered
- A JSDoc block comment containing backticks plus an apostrophe + em-dash tripped the TypeScript lexer (unterminated-regex errors). Resolved by plain-text wording in the comment.

## Known Stubs
None. The migration is GATED (NOT applied to prod) per the phase rule — local apply + advisor + assertion verification all run at the 07-09 gate. This is intentional, not a stub.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The feed.ts Phase-7 contract is in place: 07-02/03/04 (the parallel Wave-1 DB plans for E22/E23 browse_feed re-CREATE + E24 withdraw_interest migration) and the Wave-2/3 frontend plans (E20 RouteMap, E21 /places links, E23 NightCard label, E24 StandbyCard) can consume `place_slug`/`city_name`/`withdrawInterest` without re-editing feed.ts.
- GATED: the `20260606140000_e20_get_night_detail_coords.sql` migration is local-green only; prod (`ufufmcpnysvwtutpbian`) is UNTOUCHED. The local-apply + Supabase advisor + SQL-assertion verification belong to the 07-09 gate.
- Downstream feed-RPC re-CREATEs (E22/E23) MUST build on the e15 body and timestamp after 20260606140000 to avoid clobbering (Phase-6 ordering lesson).

## Self-Check: PASSED

- All created/modified files exist on disk (migration, test, feed.ts, SUMMARY).
- All task commits present in git history (91da323, e6dabc9, f12b803).

---
*Phase: 07-enhancements-and-polish-p3*
*Completed: 2026-06-05*
