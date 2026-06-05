---
phase: 04-discoverability-feed-filters-targeting-p1
plan: 03
subsystem: web-feed-ui
tags: [nextjs, react, typescript, vaul, sonner, feed-filters, empty-state, e2e, vitest]

requires:
  - phase: 04-discoverability-feed-filters-targeting-p1
    plan: 02
    provides: saveFeedFilters() self-write, FeedFilters type, FeedNight.fit
provides:
  - Real two-group FilterSheet (dealbreakers/nice to have) persisting profiles.feed_filters
  - 3 quick-filter chips in SwipeDeck (distance/price/vibe shortcuts into the sheet)
  - Filtered-vs-genuine EmptyDeck branch (active recovery + one-tap loosen)
  - feed/page.tsx feed_filters SSR seed (userId + filters props into SwipeDeck)
  - e2e/e10-feed-filters.spec.ts (forced-local searcher filter loop) + e10- testMatch
affects: [04-04 (fit pill consumes FeedNight.fit; does not touch these surfaces)]

tech-stack:
  added: []
  patterns:
    - "Apply self-writes feed_filters then fires onApplied (router.refresh) — force-dynamic page re-runs browseFeed server-side"
    - "Empty state names the most-restrictive HARD filter and loosens it explicitly (never auto-relax)"
    - "Quick chips are shortcuts INTO the sheet (setFilterOpen(true)), not inline editors (D-04)"

key-files:
  created:
    - apps/web/app/feed/__tests__/FilterSheet.test.tsx
    - apps/web/e2e/e10-feed-filters.spec.ts
  modified:
    - apps/web/app/feed/FilterSheet.tsx
    - apps/web/app/feed/SwipeDeck.tsx
    - apps/web/app/feed/page.tsx
    - apps/web/app/feed/__tests__/SwipeDeck.test.tsx
    - apps/web/app/feed/__tests__/SwipeDeck.ambient.test.tsx
    - apps/web/lib/after5/client.ts
    - apps/web/playwright.config.ts

key-decisions:
  - "onApplied refetch = router.refresh() — the feed page is force-dynamic, so a refresh re-runs the SSR browseFeed with the new feed_filters (no client refetch plumbing needed)"
  - "Component tests live in app/feed/__tests__/ (repo convention) not the plan's app/feed/*.test.tsx paths; SwipeDeck assertions extend the existing __tests__/SwipeDeck.test.tsx to reuse its client/vaul mocks"
  - "Distance/price hard filters are single-select stepped chips (caps); host gender is multi-select — matches the FeedFilters shape (max_* scalar, host_genders array)"
  - "Most-restrictive ordering for the recovery line: distance (tightest reach) > price > host gender; distance/price widen to a concrete next step, gender loosens by dropping the key"

requirements-completed: [REQ-E10]

duration: ~30min
completed: 2026-06-04
---

# Phase 4 Plan 03: Searcher Feed Filters (FilterSheet + Quick Chips + Recovery Empty State) Summary

**Turned the FilterSheet stub into the real two-group (dealbreakers/nice to have) sheet that persists profiles.feed_filters and re-queries the feed, added the 3-chip quick row + the filtered-vs-genuine recovery empty state to SwipeDeck, seeded feed_filters in the feed page, and authored the forced-local e10 e2e — all to the approved 04-UI-SPEC Barbiecore contract.**

## Performance
- **Duration:** ~30 min
- **Tasks:** 2 automated code tasks (the third task — a human visual-verify checkpoint — is deferred to the orchestrator; see below)
- **Files:** 2 created, 7 modified

## Accomplishments
- **Real FilterSheet** (`FilterSheet.tsx`): kept the vaul shell verbatim (overlay `bg-shell-ink/40`, `rounded-t-3xl bg-shell-base max-h-[80dvh] max-w-[420px] shadow-fun`, grabber, `font-heading text-3xl lowercase` "filters" title). Replaced the disabled placeholder body with two labeled groups:
  - **dealbreakers** (hard, HIDE): `who's hosting` (host_genders multi role=checkbox), `max price` (max_price single role=radio stepped chips), `how far` (max_distance_km single role=radio stepped chips).
  - **nice to have** (soft, SORT): `vibe` (vibes multi), `who pays` (who_pays multi), `when` (time_buckets: this weekend/weeknights/daytime), `their age` (host_age_range two number inputs).
  - Footer: full-width accent `apply filters` CTA (`h-14 rounded-full bg-shell-accent`) + a quiet `reset filters` text button. Apply self-writes via `saveFeedFilters`, fires `onApplied` once on success then closes; a save failure shows `that didn't save. try again?` and skips `onApplied`. Reset clears to the inclusive empty-object default. No "exclude" copy anywhere.
- **3 quick chips** (`SwipeDeck.tsx`): `distance · price · vibe` row below the day-scope header. Each reflects its active feed_filters value (e.g. `distance · ≤ 25km`); tapping ANY chip opens the FilterSheet (shortcut, not inline editor). A brand-new searcher (`{}`) sees all three inactive.
- **Filtered-vs-genuine EmptyDeck**: when a HARD filter is active the deck renders the filtered-recovery state (`nothing fits those filters.` + names the most-restrictive hard filter + a one-tap accent loosen that self-writes the loosened filters and refetches + `post your own night`). When no hard filter is set, the shipped genuinely-empty copy (`that's everyone for now.` / `touch grass`) is unchanged.
- **page.tsx**: seeds the viewer's `feed_filters` jsonb alongside the gate read and passes `userId` + `filters` into SwipeDeck; force-dynamic + browseFeed seed kept.
- **Client re-export**: added `saveFeedFilters` + `FeedFilters` to `apps/web/lib/after5/client.ts`.
- **e2e**: authored `apps/web/e2e/e10-feed-filters.spec.ts` (forced-local: seeded searcher sees the night → sets `who's hosting = men` against a woman host → filtered-empty recovery → loosen "open it to everyone" → night returns) and added `e10-` to the playwright `testMatch` regex so the post-merge run picks it up.

## Verification
- **Component vitest GREEN:** `app/feed/` suite = 29 tests pass (FilterSheet 6, SwipeDeck 11, ambient 4, useAmbientDeck 8). FilterSheet.test.tsx explicitly asserts (a) the built FeedFilters shape passed to saveFeedFilters, (b) `onApplied` fires exactly once on a successful apply, (c) `onApplied` is NOT called when saveFeedFilters rejects (toast shown instead), (d) reset clears, (e) chips toggle aria-checked.
- **Web typecheck:** `tsc --noEmit` on apps/web = 0 errors.
- **e2e NOT run here** (per the executor override): it needs a forced-local dev server + browser; the orchestrator runs `e10-feed-filters` post-merge.

## Task Commits
1. **Task 1: Real FilterSheet (two groups, persist, onApplied contract)** — `564fa33` (feat)
2. **Task 2: Quick chips + filtered-vs-genuine EmptyDeck + page seed + e2e** — `3927f34` (feat)

## Visual-Verify Deferred to Orchestrator

The plan's middle task is a `checkpoint:human-verify` (gate=blocking). A headless worktree has no dev server or browser, so it is **deferred to the orchestrator's post-merge forced-local visual-verify**, not performed or blocked on here. Check the following against `04-UI-SPEC.md` at the **@420px** phone width, signed in as the QA account on `/feed` (forced-local stack, NEVER the prod-pointed env):

**Surfaces to render/screenshot:**
1. `/feed` header region — the 3 quick chips (`distance · price · vibe`) sit BELOW the day-scope `h1`, above the card stack.
2. The vaul FilterSheet (open via a chip OR the gear).
3. The filtered-empty recovery state (set an impossible hard filter to empty the feed).
4. The genuinely-empty state (clear filters, exhaust the deck) — should be UNCHANGED from shipped.

**Specific 04-UI-SPEC contract points to check:**
- **Quick chips (§Component Contracts #1):** `min-h-[44px] rounded-full px-4 text-[13px] font-semibold lowercase shadow-md`. Inactive = `bg-white/80 text-shell-ink ring-1 ring-shell-ink/10`; active (value set) = `bg-shell-accent text-white shadow-fun` and shows its value. NOT the warm-token DatesFilter visuals.
- **Sheet IA (§2):** two labeled groups — `dealbreakers` (hard: who's hosting / max price / how far) and `nice to have` (soft: vibe / who pays / when / their age). The hard group is the ONLY thing framed as hiding; the soft group reads as preferences. NO "exclude" copy.
- **Footer (§2):** full-width accent `apply filters` CTA (`h-14 rounded-full bg-shell-accent`) + a quiet `reset filters` secondary (NOT accent).
- **Empty-state two-state copy (§4 / §Copywriting):** filtered-empty heading `nothing fits those filters.`, a named restrictive filter (e.g. `your distance is set to 10km.`), an accent loosen (e.g. `widen to 50km?`), and `post your own night`. Genuinely-empty keeps `that's everyone for now.` / `touch grass and come back later.`
- **Color reserve (§Color):** accent (`shell.accent`) only on the active chip, the apply CTA, and the recovery loosen/post links — pink is punctuation, never the chip-row background or an unselected chip.
- **Inclusive default (D-04):** a brand-new searcher (`feed_filters = {}`) sees an unfiltered feed and all three chips inactive.
- **Stop-slop:** all copy lowercase Barbiecore, dry, **no em-dashes** (verify the FilterSheet description + recovery lines).
- **Out of scope here:** the fit pill placement is 04-04's job (NightCard.tsx), not this plan — do not flag its absence against 04-03.
- **6-pillar rubric:** ≥44px taps on every chip/control, AA contrast (white-on-accent, ink-on-base), focus-visible rings, motion-reduce on the new controls.

## Files Created/Modified
- `apps/web/app/feed/FilterSheet.tsx` — stub → real two-group persisting sheet
- `apps/web/app/feed/SwipeDeck.tsx` — quick chips + filters wiring + filtered-vs-genuine EmptyDeck branch
- `apps/web/app/feed/page.tsx` — feed_filters SSR seed + userId/filters props
- `apps/web/lib/after5/client.ts` — re-export saveFeedFilters + FeedFilters
- `apps/web/app/feed/__tests__/FilterSheet.test.tsx` — NEW; persist/onApplied/reset/toast
- `apps/web/app/feed/__tests__/SwipeDeck.test.tsx` — extended; chips + recovery empty branch
- `apps/web/app/feed/__tests__/SwipeDeck.ambient.test.tsx` — mock fixups (useRouter/usePathname/saveFeedFilters)
- `apps/web/playwright.config.ts` — `e10-` added to testMatch
- `apps/web/e2e/e10-feed-filters.spec.ts` — NEW; forced-local searcher filter loop

## Deviations from Plan

### Path / Convention Adjustments

**1. [Rule 3 - Blocking] Component tests placed in `app/feed/__tests__/`, not the plan's `app/feed/*.test.tsx` paths**
- **Found during:** Task 1 (before writing tests)
- **Issue:** The plan named `apps/web/app/feed/FilterSheet.test.tsx` and `app/feed/SwipeDeck.test.tsx`. The repo convention (and the existing feed suites + reusable client/vaul mocks) live in `app/feed/__tests__/`. A `__tests__/SwipeDeck.test.tsx` already exists.
- **Fix:** Put `FilterSheet.test.tsx` in `__tests__/`; extended the existing `__tests__/SwipeDeck.test.tsx` with the chip + EmptyDeck-branch assertions (reusing its mocks) rather than forking a second top-level suite.
- **Committed in:** `564fa33`, `3927f34`

**2. [Rule 1 - Bug] Sibling `SwipeDeck.ambient.test.tsx` broke when SwipeDeck added `useRouter`**
- **Found during:** Task 2 (running the full feed suite)
- **Issue:** SwipeDeck now calls `useRouter()` (refetch) and renders BottomTabShell (`usePathname`) in the empty states; the ambient test had no `next/navigation` mock and no `saveFeedFilters` in its client mock, so it threw.
- **Fix:** Added the `next/navigation` mock (`useRouter`/`usePathname`) and `saveFeedFilters` to the ambient test's client mock. No production behavior changed.
- **Committed in:** `3927f34`

**3. [Rule 3 - Blocking] `e10-` added to the playwright `testMatch` regex**
- **Found during:** Task 2 (authoring the e2e)
- **Issue:** The config's `testMatch` is `/(5b-|chat-|m5-|m2-|m3-|route-).*\.spec\.ts$/` — it would silently skip `e10-feed-filters.spec.ts`, so the orchestrator's post-merge run would never execute the authored spec.
- **Fix:** Added `e10-` to the alternation. No other config change.
- **Committed in:** `3927f34`

---

**Total deviations:** 3 (all path/convention/blocking; no deviation from the planned UI contracts or copy).

## Known Stubs
None. The FilterSheet persists real feed_filters via the live `saveFeedFilters` seam; the empty-state loosen and quick chips are all wired to real data (the viewer's persisted `feed_filters` seeded in page.tsx). The fit pill is intentionally out of scope (04-04).

## Security
- The FilterSheet apply and the empty-state loosen both call `saveFeedFilters(client, userId, ...)` with the signed-in `userId` (seeded server-side in page.tsx from `auth.getUser()`); the `profiles_owner_all` WITH CHECK(id=auth.uid()) policy is the boundary — a forged id fails RLS (T-04-04 mitigation realized).
- The save-failure path surfaces only the fixed dry string `that didn't save. try again?`; no raw error text reaches the user (T-04-06).
- No new network endpoint, auth path, or schema change introduced — the UI consumes the existing 04-02 seams only.

## User Setup Required
None.

## Next Phase Readiness
- 04-04 (fit pill) touches NightCard.tsx only; this plan left `FeedNight.fit` untouched and did not modify NightCard.tsx / PostNightForm.tsx.
- The orchestrator should run `pnpm --filter web exec playwright test e10-feed-filters` (forced-local) post-merge and perform the deferred @420px visual-verify against 04-UI-SPEC.md before marking the checkpoint approved.

---
*Phase: 04-discoverability-feed-filters-targeting-p1*
*Completed: 2026-06-04*

## Self-Check: PASSED

- `apps/web/app/feed/FilterSheet.tsx` contains `saveFeedFilters` + `onApplied` — verified.
- `apps/web/app/feed/SwipeDeck.tsx` contains the quick-chip group + `FilteredEmptyDeck` branch — verified.
- `apps/web/app/feed/__tests__/FilterSheet.test.tsx` + `apps/web/e2e/e10-feed-filters.spec.ts` exist — verified.
- Commits `564fa33` (Task 1) and `3927f34` (Task 2) present in git log — verified.
- 29 feed vitest tests green; apps/web `tsc --noEmit` = 0 errors.
- STATE.md / ROADMAP.md NOT modified; NightCard.tsx / PostNightForm.tsx NOT touched.
