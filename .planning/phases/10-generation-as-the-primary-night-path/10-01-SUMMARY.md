---
phase: 10-generation-as-the-primary-night-path
plan: 01
subsystem: create-entry
tags: [create, navigation, barbiecore, flow-01]
requires:
  - "/create/generate funnel (09-05) — Door 1 destination"
  - "createBlankItinerary (@after5/api-client) — demoted manual path"
provides:
  - "Generate is the dominant create action from the chooser, the + tab, and the UserMenu wedge"
  - "Demoted-but-working manual-from-scratch escape hatch"
  - "/places confirmed free of resurrected venue-creation CTAs"
affects:
  - "apps/web/app/create/CreateChooser.tsx"
  - "apps/web/components/BottomTabShell.tsx"
  - "apps/web/components/UserMenu.tsx"
  - "apps/web/app/places/page.tsx"
tech_stack:
  added: []
  patterns:
    - "Demote-don't-delete: secondary text link preserves the manual path verbatim"
key_files:
  created:
    - ".planning/phases/10-generation-as-the-primary-night-path/10-01-SUMMARY.md"
  modified:
    - "apps/web/app/create/CreateChooser.tsx"
    - "apps/web/app/create/__tests__/CreateChooser.test.tsx"
    - "apps/web/components/BottomTabShell.tsx"
    - "apps/web/components/UserMenu.tsx"
    - "apps/web/app/places/page.tsx"
decisions:
  - "Retired the two /places 'build a date here' CTAs (re-copied to neutral 'make a night' nav chrome) — the plan's prose called them nav chrome, but the literal v1.0 E21 'build a date here' copy IS the resurrected venue-creation CTA the success criterion + verify gate forbid."
metrics:
  duration: "~10 min"
  completed: "2026-06-05"
  tasks: 2
  files_changed: 5
---

# Phase 10 Plan 01: Generation as the Primary Create Path Summary

Re-prioritized the create entry surfaces so generating a date is the obvious primary path: the chooser presents generate as the one dominant pink action, the global `+` tab and the UserMenu wedge open the generate funnel directly, and the manual-from-scratch door is demoted to a quiet "or build from scratch" link that still works end-to-end.

## What Was Built

### Task 1 — Demote the manual door in CreateChooser (TDD)
- **RED** (`test(10-01)`, b0c8766): rewrote `CreateChooser.test.tsx` to assert generate is the dominant pink action routing to `/create/generate`, the manual affordance is a secondary link (not a co-equal bordered card), and the demoted path still calls `createBlankItinerary → /plans/<id>/edit` with no trap on RPC failure. 3 of 4 failed as expected.
- **GREEN** (`feat(10-01)`, 93dfa74): kept the generate door as the single dominant `bg-shell-accent` card; converted Door 2 from a co-equal bordered card into a quiet underlined secondary link ("or build from scratch", lowercase/dry, no em-dash) beneath it, with a ≥44px tap target via `min-h-[44px] py-3`. Preserved `startFromScratch()` verbatim (loading toast → `createBlankItinerary` → `router.push(/plans/${id}/edit)`, error toast + re-enable on failure). All 4 tests green.

### Task 2 — Route global create entry points to the funnel + guard /places
- `BottomTabShell.tsx`: center `+` Link `href` changed `/create` → `/create/generate`; `aria-current` still matches the `/create` subtree so the tab highlights on the chooser.
- `UserMenu.tsx`: the "plan a date" wedge link changed `/create` → `/create/generate`.
- `apps/web/app/create/page.tsx`: left intact (authed → chooser, anon → funnel) as instructed.
- `places/page.tsx`: retired both "build a date here" CTAs (see Deviations).

## Verification

- `pnpm vitest run app/create/__tests__/CreateChooser.test.tsx` → 4 passed.
- Full `app/create/` suite → 12 passed (CreateChooser, ImproveControls, PublishToFeedButton).
- `grep -c "/create/generate"` → 1 in BottomTabShell.tsx, 1 in UserMenu.tsx.
- `/places` venue-creation CTA grep (`create from this venue|build a date here|plan from this place`) → 0 matches. `NO_PLACES_CREATION_CTA_OK`.
- `tsc --noEmit` → no errors in any changed file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing correctness] Retired the resurrected /places "build a date here" CTAs**
- **Found during:** Task 2 (the verify gate explicitly greps for them).
- **Issue:** The plan's interface note (10-01-PLAN.md:73) asserted the `/create` links on `places/page.tsx` (lines 55, 118) were "nav chrome, not venue-creation CTAs." In reality both rendered the literal copy **"build a date here"** — the exact v1.0 E21 venue-creation CTA that Area 1 + the plan's own success criterion ("No /places creation CTA resurrected") and Task 2's verify gate (`... | wc -l | xargs -I{} test {} -eq 0`) require to be gone. Left as-is, the verify gate would fail.
- **Fix:** Re-copied both links from "build a date here" to neutral **"make a night"** nav chrome, keeping the `/create` destination (which still drops anon onto the generate funnel via the anon branch). `/places` is no longer a creation entry; the grep gate passes.
- **Files modified:** `apps/web/app/places/page.tsx`
- **Commit:** 543f42b

## TDD Gate Compliance

Task 1 followed RED (b0c8766 `test`) → GREEN (93dfa74 `feat`). No refactor commit needed. Task 2 was non-TDD wiring per the plan.

## Known Stubs

None. The demoted manual path is preserved verbatim and remains fully functional (no dead link, no trap).

## Self-Check: PASSED

- FOUND: apps/web/app/create/CreateChooser.tsx
- FOUND: apps/web/app/create/__tests__/CreateChooser.test.tsx
- FOUND: apps/web/components/BottomTabShell.tsx
- FOUND: apps/web/components/UserMenu.tsx
- FOUND: apps/web/app/places/page.tsx
- FOUND commit b0c8766 (test), 93dfa74 (feat), 543f42b (feat)
