---
phase: 04-discoverability-feed-filters-targeting-p1
plan: 04
subsystem: web-ui
tags: [react, nextjs, tailwind, barbiecore, feed, targeting, reach-preview, fit-pill, vitest, jsdom]

requires:
  - phase: 04-discoverability-feed-filters-targeting-p1
    plan: 02
    provides: FeedNight.fit boolean, reachPreview() wrapper over reach_preview DEFINER count RPC
provides:
  - "NightCard fit pill (D-03): renders only when FeedNight.fit === true"
  - "PostNightForm live reach-preview line (D-01): debounced, four-state, {everyone}-normalized, never gates publish"
  - "reachPreview re-exported from the @after5/api-client barrel + the web client wrapper"
  - "primary_city_id + city name plumbed from /nights/new into PostNightForm"
affects: [04 visual-verify checkpoint (deferred to orchestrator)]

tech-stack:
  added: []
  patterns:
    - "fit pill mirrors the is_seed curated-badge precedent; accent-on-white/85, one of accent's few reserved uses"
    - "debounced (400ms) reachPreview in a useEffect keyed on genders/age/radius/city, with a cancelled flag to drop stale resolves"
    - "{everyone}/empty normalized to omitted target_genders at the call site (defense-in-depth over the RPC's own normalization)"
    - "aria-live=polite reach region always present so the count update is announced without stealing focus"

key-files:
  created:
    - apps/web/app/feed/__tests__/NightCard.test.tsx
  modified:
    - apps/web/app/feed/NightCard.tsx
    - apps/web/app/nights/new/PostNightForm.tsx
    - apps/web/app/nights/new/__tests__/PostNightForm.test.tsx
    - apps/web/app/nights/new/page.tsx
    - apps/web/lib/after5/client.ts
    - packages/api-client/src/index.ts

decisions:
  - "Tests co-located under each component's __tests__/ dir (the established app convention + the SwipeDeck/PostNightForm precedent), not the plan's flat src/*.test.tsx paths"
  - "Reach line stays quiet when the host has no primary_city_id (no scope to count against) instead of showing a misleading global count"
  - "Low-count threshold set at N <= 5 for the positive 'a focused crowd, widen anytime.' framing"

metrics:
  duration: ~22min
  tasks: 2
  files: 7
  completed: 2026-06-04

requirements-completed: [REQ-E10]
---

# Phase 4 Plan 04: Consumer Hint Surfaces (Fit Pill + Reach Line) Summary

**Shipped the two quiet, flattering, non-blocking consumer hints against 04-UI-SPEC.md: the "looks for someone like you" fit pill on NightCard (D-03, renders only on `FeedNight.fit === true`) and the live, debounced, {everyone}-normalized reach-preview line on PostNightForm (D-01, four encouraging states, never gates publish).**

## Performance

- **Duration:** ~22 min
- **Tasks:** 2 automated code tasks (+ 1 visual-verify checkpoint deferred to the orchestrator)
- **Files:** 7 (1 created, 6 modified)

## Accomplishments

### Task 1 — Fit pill on NightCard (D-03) — commit `19f9789`
- Added a conditional pill in the card content stack (on the bottom scrim) that renders **only when `night.fit === true`** — never a score, never a percentage, never on a non-matching card.
- Copy exactly `looks for someone like you`. Treatment per 04-UI-SPEC §3: `rounded-full px-3 py-1 font-body text-[13px] font-semibold lowercase shadow-md`, `bg-white/85 text-shell-accent` (accent reserved, NOT sage/green). Subtle leading `✨` (aria-hidden) per the spec's allowance, kept quiet.
- Coexists with the `★ curated` `is_seed` badge without collision (the badge is top-left absolute; the pill lives in the bottom content flow).
- Co-located `apps/web/app/feed/__tests__/NightCard.test.tsx`: pill present when `fit=true`, absent when `false`, never renders a digit/`%`, and both pill + curated badge render together. 4 tests green.

### Task 2 — Live reach-preview line on PostNightForm (D-01) — commit `d575b84`
- Added a single quiet `aria-live="polite"` line after the radius input, `font-body text-[13px] lowercase text-shell-ink/65` (mirrors the existing "open to everyone…" helper). NOT accent, NOT a warning color.
- Debounced (400ms) `reachPreview(client, { target_genders, target_age_range, city, radius_km })` in a `useEffect` keyed on `genders`/`ageMin`/`ageMax`/`radiusKm`/`primaryCityId`, with a `cancelled` flag so stale resolves are dropped.
- **{everyone} normalization at the call site:** when `genders` is `['everyone']` or empty, `target_genders` is sent as `[]` so an open night counts everyone instead of undercounting to ~0 (defense-in-depth over the RPC's own normalization).
- Four copy states from 04-UI-SPEC §Copywriting, all encouraging and em-dash-free: loading `counting who's around…`, normal `~{N} people match this in {city}`, low (`N <= 5`) `~{N} match this in {city}. a focused crowd, widen anytime.`, zero `no one fits this yet in {city}. loosen the targeting and they'll show up.`
- **Never gates the publish CTA** — `canPost` remains `selectedId && isDateFuture && phase !== 'saving'`; the count is purely presentational.
- Plumbed `primary_city_id` + the joined `cities.name` from `/nights/new/page.tsx` into the form as `primaryCityId` / `cityName`. When the host has no city, the reach line stays quiet rather than showing a misleading count.
- Extended `apps/web/app/nights/new/__tests__/PostNightForm.test.tsx`: loading→count render + polite announce, open-case normalization (no literal `everyone`, `city` passed), positive zero framing with publish CTA still governed by plan/time only, and a stop-slop no-em-dash assertion. 17 tests green (13 pre-existing + 4 new).

## Task Commits

1. **Task 1: Fit pill on NightCard (D-03)** — `19f9789` (feat)
2. **Task 2: Live reach-preview line on PostNightForm (D-01)** — `d575b84` (feat)

_TDD per task: each task wrote failing component tests first (pill/reach line not yet rendered → RED), then the minimal implementation turned them GREEN. RED→GREEN verified explicitly for both._

## Files Created/Modified

- `apps/web/app/feed/NightCard.tsx` — conditional `night.fit === true` fit pill on the scrim
- `apps/web/app/feed/__tests__/NightCard.test.tsx` (created) — 4 fit-pill cases
- `apps/web/app/nights/new/PostNightForm.tsx` — debounced reach state + effect + the four-state aria-live line; new `primaryCityId`/`cityName` props
- `apps/web/app/nights/new/__tests__/PostNightForm.test.tsx` — 4 new reach-line cases + reachPreview mock
- `apps/web/app/nights/new/page.tsx` — fetch `primary_city_id` + `cities.name`, pass to the form
- `apps/web/lib/after5/client.ts` — re-export `reachPreview`
- `packages/api-client/src/index.ts` — export `reachPreview` from the package barrel (was missing)

## Decisions Made

- **Tests in `__tests__/`, not the plan's flat `src/*.test.tsx`:** the app convention (and the sibling `SwipeDeck`/`PostNightForm` suites) co-locate component tests under each route's `__tests__/` dir. Matched that and the api-client Plan 04-02 precedent rather than introducing a second flat path.
- **Quiet on no-city:** if `primary_city_id` is null the reach line renders nothing — there's no city to scope the count to, and a global count would mislead.
- **Low-count threshold `N <= 5`** for the positive "a focused crowd, widen anytime." framing (the spec calls for "small N" without pinning a number).
- **Typographic apostrophe/ellipsis are fine; only the em-dash (`—`) is banned** by stop-slop. The new copy uses `'` and `…`, never `—`. The pre-existing em-dash at the header line (formerly ~315) was left untouched and not replicated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `reachPreview` not exported from the `@after5/api-client` barrel**
- **Found during:** Task 2 (typecheck of the web client re-export)
- **Issue:** Plan 04-02 added `reachPreview` to `packages/api-client/src/feed.ts` but did NOT add it to the package barrel `packages/api-client/src/index.ts`, so `@/lib/after5/client` (and any app code) could not import it — `TS2305: has no exported member 'reachPreview'`.
- **Fix:** Added `reachPreview` to the `./feed` named re-export in `packages/api-client/src/index.ts`. Verified the worktree api-client package typechecks clean (EXIT 0) and the app's only prior tsc error (the missing export) is resolved.
- **Files modified:** `packages/api-client/src/index.ts`, `apps/web/lib/after5/client.ts`
- **Commit:** `d575b84`

**2. [Rule 3 - Blocking] PostNightForm had no access to the host's city**
- **Found during:** Task 2 (reachPreview requires `city: <uuid>`)
- **Issue:** The form received `plans`/`ambientSounds`/`itineraryId` but no city, and `reach_preview` needs the host's `primary_city_id`. Without it the reach line could not be wired.
- **Fix:** `page.tsx` now selects `primary_city_id` + a `cities:primary_city_id (name)` join and passes `primaryCityId`/`cityName` props; the form falls back to quiet when null.
- **Files modified:** `apps/web/app/nights/new/page.tsx`, `apps/web/app/nights/new/PostNightForm.tsx`
- **Commit:** `d575b84`

**3. [Rule 3 - Blocking, path/convention] Tests placed in `__tests__/` dirs**
- The plan named flat `NightCard.test.tsx` / `PostNightForm.test.tsx` paths. Extended/created in the canonical `__tests__/` dirs instead (see Decisions). No behavior change.

**Total deviations:** 3 (all blocking path/wiring corrections; no production-logic deviation from the planned contracts).

## Visual-Verify Deferred to Orchestrator

This plan's third task is `checkpoint:human-verify` (forced-local browser render @420px). This executor runs headless in a worktree with no browser, so per the orchestrator override the checkpoint is **deferred, not blocking**. The orchestrator (or a follow-up forced-local verify) must check, against `04-UI-SPEC.md`:

**Fit pill (`/feed` @420px, NightCard):**
- Renders the small `looks for someone like you` pill ONLY on a card with a genuine targeting match (`fit === true`); non-matching cards show no pill.
- Style: accent text on `white/85`, `rounded-full px-3 py-1 text-[13px] font-semibold lowercase shadow-md` — **accent, never green/sage**; reads cleanly over the darkest vibe photos (sits on the scrim).
- Does NOT collide with the `★ curated` `is_seed` badge when both are present.
- Never shows a number/percentage.

**Reach line (`/nights/new`, PostNightForm):**
- Quiet `~N people match this in {city}` line under the radius input, updating live (debounced ~400ms) as gender/age/radius change.
- Narrow targeting → the low/zero copy is **encouraging, never a warning color**; the publish CTA stays enabled regardless of count.
- `everyone` targeting → the count reflects everyone (not ~0): confirms the call-site normalization end-to-end against the live RPC.
- Loading state shows `counting who's around…`.
- @420px layout, ≥44px tap targets elsewhere on the form unaffected.

**Stop-slop / rubric:** lowercase Barbiecore, **no em-dash** in the new reach line (the new copy uses `.`/`'`/`…`), accent reserved, AA contrast over vibe photos.

## Known Stubs

None — both surfaces are wired to live data (`FeedNight.fit` from `browse_feed_for_viewer`; `reachPreview` to the `reach_preview` DEFINER RPC).

## Security

- **Fit pill (T-04-02):** renders a fixed phrase from a boolean (`FeedNight.fit`) — no targeting values, no who/score, no host identity. The blind feed RPC carries no identity. Mitigation realized.
- **Reach line (T-04-03 / T-04-07):** `reachPreview` returns only an aggregate count from the DEFINER RPC; the UI renders `~N`, never identities. Narrowing reveals only a smaller count, not individuals. Accepted per spec; no per-individual data crosses.
- No new threat surface beyond the plan's `<threat_model>`: no new endpoints, auth paths, or schema changes — the city read is the host's own profile row (RLS-scoped) and the RPC is the existing authenticated DEFINER count.

## User Setup Required

None.

## Next Phase Readiness

Both consumer hints are live against the typed seams from Plan 04-02. The only outstanding item is the deferred forced-local visual-verify checkpoint (above), which the orchestrator owns. The barrel export fix (`reachPreview`) also unblocks any other UI consumer of the reach RPC.

---
*Phase: 04-discoverability-feed-filters-targeting-p1*
*Completed: 2026-06-04*

## Self-Check: PASSED

- `apps/web/app/feed/NightCard.tsx` renders the `night.fit === true` pill — verified (grep + 4 passing tests).
- `apps/web/app/feed/__tests__/NightCard.test.tsx` created — FOUND.
- `apps/web/app/nights/new/PostNightForm.tsx` wires debounced `reachPreview` + four-state aria-live line — verified (grep + 4 passing tests).
- `apps/web/app/nights/new/page.tsx` plumbs `primary_city_id` + `cities.name` — FOUND.
- `apps/web/lib/after5/client.ts` + `packages/api-client/src/index.ts` re-export `reachPreview` — FOUND (api-client package typechecks clean).
- Commits `19f9789` (feat 04-04 fit pill) and `d575b84` (feat 04-04 reach line) present in git log.
- Both component test files green: 21/21 (NightCard 4, PostNightForm 17).
- No modifications to STATE.md / ROADMAP.md; did not touch FilterSheet.tsx / SwipeDeck.tsx / feed/page.tsx.
