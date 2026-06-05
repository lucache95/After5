---
phase: 07-enhancements-and-polish-p3
plan: 06
subsystem: ui
tags: [next, react, places, venue-links, blind-contract, vitest]

requires:
  - phase: 07-04
    provides: PlanTimeline linkSlugs opt-in prop (default off) + StopRow /places link rendering
  - phase: 07-01
    provides: normalizeNightDetailStops reading o.place_slug into NightDetailStop.place_slug
provides:
  - LockDetail is the ONLY caller setting PlanTimeline linkSlugs=true (post-match venue identity, D-01)
  - matched-night stops link their name to /places/[slug]; slugless stops degrade to plain text
  - the legacy /create funnel retired from /places/[slug] (read-only post-match identity surface)
affects: [phase-07-09 visual-verify, places, matches, blind-contract]

tech-stack:
  added: []
  patterns:
    - "Per-call opt-in identity surface: shared PlanTimeline stays blind by default; only the post-lock LockDetail flips linkSlugs=true (T-07-18 mitigated)"
    - "Graceful degrade on absent catalog data: a slugless stop renders plain text, never a broken /places link / 404 (T-07-19)"

key-files:
  created:
    - apps/web/app/matches/__tests__/lock-detail-slug.test.tsx
  modified:
    - apps/web/app/matches/[lockId]/LockDetail.tsx
    - apps/web/app/places/[slug]/page.tsx

key-decisions:
  - "LockDetail is the single linkSlugs=true caller — verified by grep across all app callers"
  - "Removed ALL FOUR /create CTAs on /places/[slug] (plan named 2; the page had 4), to hit grep-count 0"
  - "Kept the 'build a night around it' cross-link section header + its /dates/[slug] cards (those are read-only night links, not the /create funnel)"

patterns-established:
  - "Opt-in identity prop default-off keeps a shared blind component safe across surfaces; enable only on the revealed surface"

requirements-completed: [REQ-E21]

duration: 12min
completed: 2026-06-05
---

# Phase 7 Plan 06: Venues into the loop (post-match) Summary

**Post-match LockDetail links each catalog stop's name to /places/[slug] (the only linkSlugs=true caller), degrades slugless stops to plain text, and retires the legacy /create funnel from the venue page so it reads as a read-only post-match identity surface.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-05
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- LockDetail (post-lock, identity revealed) now passes `linkSlugs` to PlanTimeline — the ONLY caller that does (blind contract held everywhere else, T-07-18).
- The matches/[lockId] loader already carried `place_slug` through `normalizeNightDetailStops`; no select/loader change was needed — verified, not assumed.
- Slug-bearing stops link to /places/[slug]; slugless stops degrade to plain text (T-07-19 / D-01 graceful degrade), locked by a new test.
- All four legacy "build a date here" / "build a date with this" → `/create` CTAs removed from /places/[slug]; the page is now a read-only post-match identity surface with no dating-vertical replacement CTA and no `/places` global nav.

## Task Commits

1. **Task 1 + 3: LockDetail linkSlugs + slug-link test** - `44647ff` (feat)
2. **Task 2: retire /create CTAs on /places/[slug]** - `8e4b46c` (feat)

_Task 1 (tdd) and Task 3 (the test) were committed together: the test directly verifies Task 1's behavior and they are mutually load-bearing._

## Files Created/Modified
- `apps/web/app/matches/[lockId]/LockDetail.tsx` - PlanTimeline call sets `linkSlugs` (post-lock reveal; the only true caller)
- `apps/web/app/places/[slug]/page.tsx` - removed all four /create CTAs + unused ArrowRight/Sparkles imports; read-only identity surface
- `apps/web/app/matches/__tests__/lock-detail-slug.test.tsx` - asserts slug-present link, slug-absent plain text, and a mixed plan (only slug-bearing stops link)

## Decisions Made
- **LockDetail is the sole linkSlugs=true caller** — verified via `grep -rn linkSlugs apps/web/app`; only LockDetail.tsx passes it. Blind feed/offer surfaces leave it default-off (Plan 04).
- **Removed 4, not 2, /create CTAs** — the plan named the header nav (:263-269) and the at-home body (:459-465), but the live file also had an out-of-house body CTA and a cross-link footer CTA. The plan's own verify (`grep -c 'href="/create"' == 0`) requires removing all of them, so all four were retired.
- **Loader carried place_slug already** — the matches loader selects the full `stops` jsonb and runs the Plan-01 normalizer; no extra select was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Removed two additional /create CTAs beyond the two the plan named**
- **Found during:** Task 2 (retire /create CTAs)
- **Issue:** The plan referenced two /create CTAs (header :263-269, at-home body :459-465). The current file had four: the out-of-house body CTA (~:514) and the cross-link footer CTA (~:576) also linked /create. Leaving them would fail the plan's own `grep -c 'href="/create"' == 0` acceptance and leave the legacy funnel partially live (D-01 violation).
- **Fix:** Removed all four /create CTAs and the now-unused ArrowRight/Sparkles imports.
- **Files modified:** apps/web/app/places/[slug]/page.tsx
- **Verification:** `grep -c 'href="/create"'` == 0; `pnpm typecheck` green.
- **Committed in:** 8e4b46c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical — completes the D-01 funnel retirement)
**Impact on plan:** Necessary to satisfy the plan's own grep-0 acceptance and fully retire the funnel. No scope creep — same surface, same intent.

## Issues Encountered
None. The Plan-04 and Plan-01 building blocks (linkSlugs prop, place_slug normalizer) were already in place, so this plan was pure wiring + cleanup.

## Threat Surface
- T-07-18 (slug link on a non-revealed surface): mitigated — LockDetail is the only linkSlugs=true caller; PlanTimeline default-off; PlanTimeline.test.tsx still asserts the blind contract (8/8 green).
- T-07-19 (broken /places link / 404 from a non-catalog place): mitigated — slugless stops render plain text; covered by lock-detail-slug.test.tsx.

No new security-relevant surface introduced (no network endpoints, no auth paths, no schema changes).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- REQ-E21 user-facing acceptance is implemented. Visual-verify @420px (venue links on LockDetail + the read-only /places page) is deferred to the 07-09 phase-close gate per the phase plan.
- No DB work in this plan; nothing gated for prod-apply here.

---
*Phase: 07-enhancements-and-polish-p3*
*Completed: 2026-06-05*

## Self-Check: PASSED
- All created/modified files exist on disk (4/4).
- Both task commits present in git history (44647ff, 8e4b46c).
