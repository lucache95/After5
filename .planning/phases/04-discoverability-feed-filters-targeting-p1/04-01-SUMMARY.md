---
phase: 04-discoverability-feed-filters-targeting-p1
plan: 01
subsystem: database
tags: [postgres, rpc, jsonb, rls, postgis, feed-filters, targeting, supabase, security-definer]

requires:
  - phase: 03-marketplace-completeness
    provides: date_instances.target_genders / target_age_range / search_radius_km targeting columns (consumed here)
  - phase: 02 (m4)
    provides: browse_feed_for_viewer blind feed RPC + keyset cursor (extended here)
provides:
  - profiles.feed_filters jsonb column (inclusive empty-object default, self-write via profiles_owner_all, object CHECK)
  - browse_feed_for_viewer extended with hard WHERE filters (host gender / max price / max distance), soft ORDER BY score (vibe / who-pays / time), and a targeting-only fit boolean
  - reach_preview(text[], int4range, uuid, numeric) DEFINER count RPC for the host pre-post nudge
  - time_bucket_of(timestamptz) immutable time-of-day helper
  - regenerated packages/types/src/database.ts with feed_filters + reach_preview + fit
  - full e10_* SQL test suite (feed filters, reach preview, feed_filters RLS) + extended blind test
affects: [04-02 (TypeScript wiring: FilterSheet, fit pill, reach line, empty-state recovery), prod-apply gated step]

tech-stack:
  added: []
  patterns:
    - "{everyone}/{} open-targeting normalization centralized in SQL (both browse_feed_for_viewer fit and reach_preview)"
    - "fit is a pure targeting signal (date_fits_viewer only), never gated by the soft score (D-03/SC-1)"
    - "soft-filter score is the LEADING ORDER BY key with the keyset cursor unchanged on (starts_at,id) -- best-effort within the fetched window v1"
    - "hard filters applied only when set (inclusive default); absent jsonb key = no filter"

key-files:
  created:
    - supabase/migrations/20260605120400_e10_feed_filters_column.sql
    - supabase/migrations/20260605120500_e10_browse_feed_filters.sql
    - supabase/migrations/20260605120600_e10_reach_preview.sql
    - supabase/migrations/20260605120700_e10_feed_indexes.sql
    - supabase/tests/e10_browse_feed_filters.sql
    - supabase/tests/e10_reach_preview.sql
    - supabase/tests/e10_feed_filters_rls.sql
  modified:
    - supabase/tests/s5_browse_feed_blind.sql
    - packages/types/src/database.ts

key-decisions:
  - "Read feed_filters inside the RPC via the me CTE (no new param) -- mirrors the existing profile-pref reads; client persists then requeries"
  - "Cursor stays keyed on (starts_at,id); composite soft+targeting score is the leading ORDER BY key (Open Question 1 resolved: best-effort within the fetched window v1)"
  - "Normalize {everyone}|{} at read in BOTH RPCs (no source backfill this plan) -- robust regardless of stored prod data"
  - "fit = date_fits_viewer ONLY (targeting), not soft-gated -- so a brand-new searcher with empty feed_filters still sees the fit pill on a perfectly targeted night"

patterns-established:
  - "Pattern: grant trio (revoke public + revoke anon + grant authenticated) re-emitted on every re-emitted/new function signature"
  - "Pattern: pgTAP-style keyset test captures the real starts_at BEFORE the authenticated-role switch (date_instances is RLS-hidden from the viewer under that role)"

requirements-completed: [REQ-E10]

duration: 35min
completed: 2026-06-04
---

# Phase 4 Plan 01: Feed Filters & Targeting DB Foundation Summary

**profiles.feed_filters jsonb + browse_feed_for_viewer extended with hard WHERE filters, soft ORDER BY score, and a targeting-only fit boolean, plus a lean reach_preview DEFINER count RPC -- applied locally, types regenerated, advisor clean.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-04T18:47:00Z (approx)
- **Completed:** 2026-06-04T19:22:00Z
- **Tasks:** 3
- **Files modified:** 9 (7 created, 2 modified)

## Accomplishments
- Added `profiles.feed_filters jsonb` (inclusive empty-object default, object CHECK not-valid, self-write via the existing `profiles_owner_all` policy -- no new RLS).
- Extended `browse_feed_for_viewer`: hard host-gender / max-price / max-distance filters HIDE non-matching nights in WHERE; soft vibe / who-pays / time-of-day score only RE-SORTS via ORDER BY; a 14th `fit boolean` column projects a targeting-only signal that is true even when the searcher has zero soft filters set. Blind 13-col contract, hour-truncated time, and the `(starts_at,id)` keyset cursor all preserved.
- Added `reach_preview` DEFINER count RPC (aggregate-only, `{everyone}`/`{}` normalized, age + radius narrowing, grant trio).
- Applied all 4 migrations to the local stack, regenerated `packages/types/src/database.ts` from the live schema (now carries `feed_filters`, `reach_preview`, and the `fit` column), and ran the local security advisor equivalents clean.
- Authored the full `e10_*` SQL suite (7 feed-filter assertions, reach-preview counts + anon-revoke, feed_filters self-write RLS) and extended `s5_browse_feed_blind.sql` to assert the new `fit` column with no identity leak. All e10_* + the blind test pass GREEN.

## Task Commits

1. **Task 1: Wave-0 SQL test scaffolds** - `54edcac` (test)
2. **Task 2: 4 migrations (feed_filters column, browse_feed extension, reach_preview, indexes)** - `62fc5fe` (feat)
3. **Task 3: [BLOCKING] local apply + type regen + advisor** - `adcbcc5` (chore)

_TDD plan gate sequence: RED (`54edcac` test) before GREEN (`62fc5fe` feat) confirmed -- the e10_* suite failed against the pre-migration schema (feed_filters column absent) and passes after the migrations land._

## Files Created/Modified
- `supabase/migrations/20260605120400_e10_feed_filters_column.sql` - profiles.feed_filters jsonb + object CHECK (no new RLS)
- `supabase/migrations/20260605120500_e10_browse_feed_filters.sql` - browse_feed_for_viewer + hard WHERE / soft ORDER BY / fit; time_bucket_of helper; grant trio
- `supabase/migrations/20260605120600_e10_reach_preview.sql` - reach_preview DEFINER count RPC + grant trio
- `supabase/migrations/20260605120700_e10_feed_indexes.sql` - profiles(dating_enabled,verification), profiles(gender), itineraries(total_cost_pp) btrees
- `supabase/tests/e10_browse_feed_filters.sql` - hard hide / soft re-sort / targeting-only fit / everyone-norm / keyset no-dup
- `supabase/tests/e10_reach_preview.sql` - counts / everyone-norm / age+radius narrowing / anon revoke
- `supabase/tests/e10_feed_filters_rls.sql` - feed_filters self-write only
- `supabase/tests/s5_browse_feed_blind.sql` - extended: assert fit column + no creator/itinerary/venue id leak
- `packages/types/src/database.ts` - regenerated from live local schema

## Decisions Made
- **No-new-param feed_filters read:** the RPC reads `coalesce(pr.feed_filters,'{}')` in the `me` CTE, matching the existing profile-pref reads; the client persists then re-queries. Keeps web/native consistent.
- **Cursor vs soft-score (Open Question 1):** keyset stays on `(starts_at,id)`; the composite `(date_fits_viewer::int*4 + vibe_pts + pay_pts + time_pts)` is the leading ORDER BY key, documented inline as best-effort ranking within the fetched window v1. The cursor predicate is unchanged so pagination cannot skip or dupe.
- **Normalize-at-read only (Open Question 2):** `{everyone}`/`{}` are normalized in both RPCs; no source backfill or PostNightForm change this plan (out of scope, fenced from carry-forward #2).
- **fit is targeting-only:** `fit = date_fits_viewer` (gender+age inclusion, everyone-normalized), never multiplied/gated by the soft score -- the explicit D-03/SC-1 regression guard, locked by test E10.5 (fit=true with `feed_filters='{}'`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] e10 keyset test read RLS-hidden date_instances under the authenticated role**
- **Found during:** Task 3 (running the e10_browse_feed_filters suite against the applied schema)
- **Issue:** Test E10.7 drove the page-2 keyset cursor by re-reading `date_instances.starts_at` AFTER `set local role authenticated`. Under that role the viewer cannot see those rows directly (only via the DEFINER feed RPC), so the lookup returned NULL, the cursor short-circuited (`p_after_starts is null`), and page 2 duplicated page 1.
- **Fix:** Capture the real `(id, starts_at)` of every instance into a temp table BEFORE the role switch; compute the cursor after `reset role`; run each paginated feed read in its own role context.
- **Files modified:** supabase/tests/e10_browse_feed_filters.sql
- **Verification:** E10.7 now asserts zero overlap across two pages and passes.
- **Committed in:** `adcbcc5`

**2. [Rule 1 - Bug] e10 test used distance_pref_km values outside the 1..150 CHECK**
- **Found during:** Task 3 (first applied-schema run aborted at the test #1 profile update)
- **Issue:** Tests set `distance_pref_km` to 500 / 100000 to keep the baseline gate generous, but `profiles_distance_pref_chk` enforces 1..150.
- **Fix:** Clamped all values to 150 (still generous relative to the seeded city distances).
- **Files modified:** supabase/tests/e10_browse_feed_filters.sql
- **Verification:** Suite runs past the profile updates; all 7 assertions pass.
- **Committed in:** `adcbcc5`

**3. [Rule 3 - Blocking] far-distance test had no second city with a centroid locally**
- **Found during:** Task 3 (the max-distance case needs a night beyond the 10km hard cap but within the baseline gate)
- **Issue:** The local stack seeds only `kelowna` with a centroid, so the "pick a far city" select returned NULL and tripped the guard.
- **Fix:** The test now inserts an inline far city ~50km from kelowna (kelowna centroid offset in longitude), with a band assertion (10km..150km) so the hard cap hides it while the baseline keeps it.
- **Files modified:** supabase/tests/e10_browse_feed_filters.sql
- **Verification:** E10.3 hides the far-city night and keeps the same-city night; passes.
- **Committed in:** `adcbcc5`

**4. [Rule 3 - Blocking] canonical types path is packages/types/src/database.ts, not packages/types/database.ts**
- **Found during:** Task 3 (regenerating types)
- **Issue:** The plan frontmatter listed `packages/types/database.ts`, but the project `db:types` script and the existing committed file live at `packages/types/src/database.ts`.
- **Fix:** Regenerated into the real canonical path (matching the project script) so downstream imports resolve.
- **Files modified:** packages/types/src/database.ts
- **Verification:** File contains feed_filters (3), reach_preview (1), fit: boolean (1).
- **Committed in:** `adcbcc5`

---

**Total deviations:** 4 auto-fixed (2 test-correctness bugs, 2 blocking environment/path fixes)
**Impact on plan:** All four were test/environment corrections to make the Task-1 suite faithfully exercise the real local schema (RLS, the distance CHECK, single-seeded-city reality) and to write types to the project's actual canonical path. No production logic changed; no scope creep. The migration bodies match the planned contracts verbatim.

## Issues Encountered
- **Pre-existing unrelated test failure (out of scope):** `pnpm db:test` aborts at `supabase/tests/p2_e2e_jobs_dispatch.sql` ("claim returned wrong job", line 36). The test belongs to the P2 jobs/dispatch subsystem (commit 3b5066a), references none of the E10 objects, and depends on the shared local job-queue claim order left by other sessions. Logged to `deferred-items.md`; not fixed (SCOPE BOUNDARY). The full e10_* suite and the extended blind test all pass.

## Security
- anon EXECUTE revoked on both `reach_preview` and the re-emitted `browse_feed_for_viewer`; authenticated granted (asserted by E10.RP.d + the local advisor check).
- `search_path` pinned on both DEFINER functions; `time_bucket_of` is IMMUTABLE/`language sql` (not DEFINER, references no schema objects -- mutable-search-path lint N/A).
- `profiles` RLS still enabled; no new policy added (`profiles_owner_all` covers feed_filters self-write -- asserted by e10_feed_filters_rls.sql).
- The DEFINER-executable note on reach_preview is the app's established accepted pattern (shared by all match_* RPCs); it returns only an aggregate count, never row identity.

## User Setup Required
None - no external service configuration required. Prod-apply of the 4 migrations is the separate gated/batched step the user runs after phase verification (OUT OF SCOPE here; do NOT push to prod ufufmcpnysvwtutpbian).

## Next Phase Readiness
- The DB contracts (feed_filters column, browse_feed fit + hard/soft, reach_preview) and regenerated types are in place, so Plan 04-02 (FilterSheet, fit pill, reach line, empty-state recovery) can compile against real types.
- Blocker/reminder: the 4 e10 migrations are applied LOCALLY only; prod-apply remains the deferred gated step.

---
*Phase: 04-discoverability-feed-filters-targeting-p1*
*Completed: 2026-06-04*

## Self-Check: PASSED

All 9 created/modified files verified present on disk; all 4 commit hashes (54edcac, 62fc5fe, adcbcc5, 543e38b) verified in git history.
