---
phase: 07-enhancements-and-polish-p3
plan: 05
subsystem: feed
tags: [feed, map, skeleton, blind-contract, E20, E25]
requires:
  - "RouteMap (apps/web/components/itinerary/RouteMap.tsx, Plan 07-04)"
  - "get_night_detail per-stop lat/lng (Plan 07-01)"
provides:
  - "real static RouteMap wired into the feed NightDetailSheet 'the route' section (E20)"
  - "in-sheet shimmer skeleton while get_night_detail pends (E25, D-02)"
  - "NightDetailSheet.test.tsx locking skeleton + map + blind-contract guard"
affects:
  - "apps/web/app/feed/NightDetailSheet.tsx"
tech-stack:
  added: []
  patterns:
    - "reduced-motion shimmer skeleton mirroring feed/loading.tsx atom"
    - "coords-only RouteMap mount (blind contract: no linkSlugs, no identity)"
key-files:
  created:
    - "apps/web/app/feed/__tests__/NightDetailSheet.test.tsx"
  modified:
    - "apps/web/app/feed/NightDetailSheet.tsx"
decisions:
  - "E25 skeleton branches on detail===null && open; replaces the blind summary while pending (D-02)"
  - "RouteMap mounts only when >=1 stop has coords; 0-coords keeps the 'short hop apart' placeholder"
  - "the feed sheet stays blind: PlanTimeline rendered with linkSlugs unset (default false); RouteMap plots coords only"
metrics:
  duration: ~12m
  completed: 2026-06-05
---

# Phase 7 Plan 05: feed detail-sheet map + skeleton Summary

Wired the real pink static RouteMap and a reduced-motion shimmer skeleton into the feed NightDetailSheet, keeping the sheet blind (no host identity, no /places slug link).

## What Was Built

**Task 1 — RouteMap swap (E20)** [`73dfcc0`]
Replaced the placeholder route viz (`NightDetailSheet.tsx:264-287`) with `<RouteMap stops={stops} />` inside the `the route` section. A `hasMappedStops` guard renders the map only when >=1 stop carries `lat`/`lng`; with 0 coords the section keeps its "short hop apart" placeholder tone (RouteMap itself returns null at 0 coords, so this is belt-and-suspenders against a broken tile). The eyebrow and section position (after the timeline, before the host hint) are unchanged. PlanTimeline still renders with `linkSlugs` unset (blind contract preserved).

**Task 2 — in-sheet skeleton (E25, D-02)** [`01bb0b1`]
Added a `DetailSkeleton` component and a `pending = detail === null && open` branch. While `get_night_detail` resolves, the scrollable body shows a silent shimmer holding the new card's shape: hero block + chip row + hook line + 3 timeline rows. The shimmer atom mirrors `feed/loading.tsx` exactly (`animate-pulse ... bg-shell-ink/10 motion-reduce:animate-none`) so it settles to a static placeholder under reduced-motion. No spinner, no caption text. On resolve, the real content replaces the skeleton.

**Task 3 — NightDetailSheet.test.tsx** [`77cc4ff`]
Created the test file (5 cases): skeleton-while-pending, real-content-on-resolve, RouteMap at >=1 coord, "short hop apart" fallback at 0 coords, and the blind-contract guard asserting the sheet never renders a `/places/` slug link (T-07-17).

## Verification

- `pnpm vitest run apps/web/app/feed/__tests__/NightDetailSheet.test.tsx` — 5/5 green.
- `pnpm typecheck` — green (full monorepo).
- RED-first confirmed: skeleton + map assertions failed before implementation; fallback + blind-contract assertions passed pre-implementation (RouteMap already null-safe; PlanTimeline already blind).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test assertion] `/the night/i` matched two nodes**
- **Found during:** Task 2 (running the suite after the skeleton landed).
- **Issue:** The regex `/the night/i` matched both the `the night` section eyebrow and the reassurance copy "you're swiping on the night, not the face", so `findByText` threw on multiple matches. This was a test-authoring imprecision, not an implementation bug.
- **Fix:** Tightened the two affected assertions to the exact string `'the night'` (the eyebrow).
- **Files modified:** `apps/web/app/feed/__tests__/NightDetailSheet.test.tsx`
- **Commit:** `77cc4ff`

## Blind Contract (T-07-17)

The sheet stays blind. `PlanTimeline` is rendered with `linkSlugs` unset (defaults false → no `/places` link), `RouteMap` plots coordinates only (no names/slugs/host data), and the test file asserts no `a[href*="/places/"]` exists even when a stop carries a `place_slug`. No host identity reaches the blind pre-swipe surface.

## Notes for Downstream

- Visual-verify @420px (map render + skeleton shape + reduced-motion) is deferred to the 07-09 phase-close gate per the plan and 07-CONTEXT.
- `Route` (lucide) is still imported and used by the no-coords fallback block.

## Self-Check: PASSED

- FOUND: apps/web/app/feed/NightDetailSheet.tsx (modified)
- FOUND: apps/web/app/feed/__tests__/NightDetailSheet.test.tsx (created)
- FOUND commit 73dfcc0 (Task 1), 01bb0b1 (Task 2), 77cc4ff (Task 3)
