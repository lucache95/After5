---
phase: 04-discoverability-feed-filters-targeting-p1
plan: 02
subsystem: api-client
tags: [typescript, api-client, supabase, rpc, feed-filters, targeting, reach-preview, vitest]

requires:
  - phase: 04-discoverability-feed-filters-targeting-p1
    plan: 01
    provides: profiles.feed_filters jsonb column, browse_feed_for_viewer fit column, reach_preview RPC, regenerated packages/types/src/database.ts
provides:
  - FeedNight.fit boolean (targeting-only signal surfaced to the UI)
  - reachPreview() wrapper over the reach_preview DEFINER count RPC (host pre-post nudge)
  - FeedFilters type (shared shape for the FilterSheet + the self-write)
  - saveFeedFilters() PostgREST self-write of profiles.feed_filters (no RPC)
affects: [04-03, 04-04 (UI plans consuming these typed seams: fit pill, reach line, FilterSheet persistence)]

tech-stack:
  added: []
  patterns:
    - "RPC wrappers send undefined for omitted optional params; the SQL normalizes the open/everyone default (reachPreview)"
    - "self-owned jsonb column written via PostgREST .update().eq('id', userId) gated by profiles_owner_all (no new RPC, no new policy)"
    - "co-located vitest mocks the After5Client: read path chains .single(); write path awaits .eq() resolving to { error }"

key-files:
  created: []
  modified:
    - packages/api-client/src/feed.ts
    - packages/api-client/src/__tests__/feed.test.ts
    - packages/api-client/src/profile.ts
    - packages/api-client/src/__tests__/profile.test.ts

key-decisions:
  - "Wired reachPreview to the REAL regenerated reach_preview signature (p_target_genders, p_target_age_range, p_city, p_radius_km) — the Wave-1 handoff's guessed p_viewer/p_search_radius_km do not exist in database.ts"
  - "Tests live in the canonical packages/api-client/src/__tests__/ dir (where the real mockClient/fakeClient patterns already are), not the plan's src/feed.test.ts path — matches the repo convention and reuses the established mocks"
  - "saveFeedFilters takes no RPC: feed_filters is owner-scoped and covered by profiles_owner_all; a forged userId fails RLS (T-04-04 mitigation realized at the DB boundary)"

requirements-completed: [REQ-E10]

duration: 12min
completed: 2026-06-04
---

# Phase 4 Plan 02: Feed Filters & Targeting api-client Wiring Summary

**Wired the api-client layer to the Plan 04-01 DB contracts: FeedNight.fit, the reachPreview() count wrapper (real reach_preview signature), the shared FeedFilters type, and the saveFeedFilters() PostgREST self-write — the typed seams the UI plans (04-03/04-04) compile against.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments
- Added `fit: boolean` to the `FeedNight` interface — the targeting-only signal `browse_feed_for_viewer` now projects (D-03: true even with empty feed_filters).
- Added `reachPreview(client, { target_genders?, target_age_range?, city, radius_km? })` over the `reach_preview` DEFINER count RPC. Wired to the **real** regenerated signature (`p_target_genders` / `p_target_age_range` / `p_city` / `p_radius_km`). Throws on error; coerces a null/absent count to `0`; omitted params send `undefined` so the SQL applies the open/everyone default.
- Added the exported `FeedFilters` interface (optional `host_genders` / `max_price` / `max_distance_km` / `vibes` / `who_pays` / `time_buckets` / `host_age_range`) — the shape the FilterSheet builds and the RPC unpacks.
- Added `saveFeedFilters(client, userId, filters)` — a PostgREST self-write of `profiles.feed_filters` scoped to `.eq('id', userId)`, gated by the existing `profiles_owner_all` policy (no RPC, no new policy). Throws on error.
- Co-located vitest covers reachPreview (count / undefined-on-omit / throw / null→0), the FeedNight.fit passthrough, and saveFeedFilters (scoped self-write patch / throw). Full `@after5/api-client` suite green (24 tests); package typechecks clean against the regenerated `database.ts`.

## Task Commits

1. **Task 1: FeedNight.fit + reachPreview() in feed.ts** — `56a2366` (feat)
2. **Task 2: FeedFilters type + saveFeedFilters() in profile.ts** — `92e4ebe` (feat)

_TDD per task: each task added failing tests first (reachPreview/saveFeedFilters not yet exported → RED), then the minimal implementation turned them GREEN. Verified RED→GREEN explicitly for both._

## Files Created/Modified
- `packages/api-client/src/feed.ts` — `FeedNight.fit` + exported `reachPreview()` wrapper
- `packages/api-client/src/__tests__/feed.test.ts` — fit passthrough + reachPreview (count / undefined-on-omit / throw / null→0)
- `packages/api-client/src/profile.ts` — `Json` type import, exported `FeedFilters` interface + `saveFeedFilters()` self-write
- `packages/api-client/src/__tests__/profile.test.ts` — saveFeedFilters scoped-write + throw, with a write-path mock client

## Decisions Made
- **Real RPC signature over the handoff guess:** `reach_preview` in the regenerated `database.ts` takes `p_target_genders` / `p_target_age_range` (unknown int4range) / `p_city` / `p_radius_km`. The Wave-1 handoff note speculated `p_viewer` / `p_search_radius_km`; those columns are not in the live types, so the wrapper is wired to the verified signature. The args object is cast `as never` (the established postNight/updateNight convention) so the `unknown` int4range arg type is accepted.
- **Canonical test directory:** the substantive mock-client patterns (`mockClient`, `mockAuthedClient`, `fakeClient`) already live in `packages/api-client/src/__tests__/`. I extended those files rather than the plan-named `src/feed.test.ts` / `src/profile.test.ts`, to reuse the mocks and follow the repo convention. (`src/feed.test.ts` exists but only covers `normalizeNightDetailStops`; left untouched.)
- **No RPC for the filter write:** `feed_filters` is an owner-scoped column; `saveFeedFilters` writes it via PostgREST `.update().eq('id', userId)`, mirroring `savePreferences`. The `profiles_owner_all` WITH CHECK(id=auth.uid()) policy is the boundary — a forged userId fails RLS, not the client (T-04-04 mitigation).

## Deviations from Plan

### Path / Convention Adjustments (not code-behavior changes)

**1. [Rule 3 - Blocking] Test files placed in the canonical `__tests__/` dir, not the plan's `src/*.test.ts` paths**
- **Found during:** Task 1 (before writing tests)
- **Issue:** The plan named `packages/api-client/src/feed.test.ts` and `src/profile.test.ts`. The substantive vitest suites + reusable mock-client helpers already live in `packages/api-client/src/__tests__/feed.test.ts` and `.../profile.test.ts`. Adding a second top-level suite would duplicate/fork the mocks.
- **Fix:** Extended the existing `__tests__/` suites (reusing `mockClient` / `fakeClient`); added a write-path mock for the `.eq()`-resolves-to-`{error}` self-write.
- **Files modified:** packages/api-client/src/__tests__/feed.test.ts, packages/api-client/src/__tests__/profile.test.ts
- **Verification:** Full `@after5/api-client` suite green (24 tests).
- **Committed in:** `56a2366`, `92e4ebe`

**2. [Rule 3 - Blocking] reachPreview wired to the verified reach_preview signature**
- **Found during:** Task 1
- **Issue:** The Wave-1 handoff guessed `reach_preview(p_target_genders, p_target_age_range, p_viewer, p_search_radius_km)`. The regenerated `database.ts` shows the real signature is `p_target_genders` / `p_target_age_range` / `p_city` / `p_radius_km` (no `p_viewer`, no `p_search_radius_km`).
- **Fix:** Wrapper sends `p_city` / `p_radius_km` (matching the plan's own `<interfaces>` block, which was correct). No `p_viewer` is passed.
- **Files modified:** packages/api-client/src/feed.ts
- **Verification:** `pnpm typecheck` (tsc --noEmit) green against `database.ts`; the reachPreview test asserts the exact RPC arg object.
- **Committed in:** `56a2366`

---

**Total deviations:** 2 (both blocking path/signature corrections; no production-logic deviation from the planned contracts).

## Issues Encountered
- **Worktree dependency resolution (environment, not a code change):** the executor worktree ships no `node_modules`; workspace deps (`@after5/types`, `@after5/business`) are hoisted to the main checkout. To run vitest/tsc I ran the main repo's `node_modules/.bin/{vitest,tsc}` and, for the runtime `@after5/business` import in profile.ts, temporarily symlinked `packages/api-client/node_modules` from the main checkout for the duration of each test/typecheck run. The symlink was removed before every `git status` / commit — no symlink or `node_modules` entry is tracked or committed. This is a verification scaffold only; no source behavior changed.

## Security
- `saveFeedFilters` performs no privilege elevation: it writes the caller's own `profiles.feed_filters` via PostgREST, gated by `profiles_owner_all` WITH CHECK(id=auth.uid()). A forged `userId` fails RLS (0 rows / error) — the realized T-04-04 mitigation.
- `reachPreview` calls a DEFINER RPC that returns only an aggregate count (never row identity); anon EXECUTE is revoked at the DB (Plan 04-01). The `FeedFilters` compile-time shape constrains what reaches the filter jsonb (T-04-05).
- No new threat surface beyond the plan's `<threat_model>` — no new endpoints, auth paths, or schema changes introduced in this api-client wiring.

## User Setup Required
None.

## Next Phase Readiness
- The typed seams are in place: `FeedNight.fit`, `reachPreview()`, `FeedFilters`, and `saveFeedFilters()` are named exports with explicit return types, tested and typechecking against the live regenerated types. Plans 04-03 (FilterSheet + fit pill + reach line) and 04-04 can compile against them directly.

---
*Phase: 04-discoverability-feed-filters-targeting-p1*
*Completed: 2026-06-04*

## Self-Check: PASSED

- `packages/api-client/src/feed.ts` exports `reachPreview` and `FeedNight.fit` — verified (grep + tsc).
- `packages/api-client/src/profile.ts` exports `FeedFilters` + `saveFeedFilters` — verified (grep + tsc).
- Commits `56a2366` (feat 04-02 feed) and `92e4ebe` (feat 04-02 profile) present in git log.
- Full `@after5/api-client` vitest suite green (24 tests); package typecheck EXIT 0.
