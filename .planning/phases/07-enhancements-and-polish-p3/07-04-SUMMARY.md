---
phase: 07-enhancements-and-polish-p3
plan: 04
subsystem: feed-detail-ui
tags: [map, mapbox, plan-timeline, blind-contract, e20, e21]
requires:
  - "NightDetailStop.lat/lng/place_slug (Plan 01 — packages/api-client/src/feed.ts)"
  - "ItineraryMap polyline encoder + static-url builder + lightbox (apps/web/components/itinerary/ItineraryMap.tsx)"
provides:
  - "RouteMap: pink/NightDetailStop static-map variant (apps/web/components/itinerary/RouteMap.tsx)"
  - "PlanTimeline coord deep-link href (E20)"
  - "PlanTimeline opt-in linkSlugs prop, default false (E21 / D-01 blind contract)"
affects:
  - "Plan 05 (detail sheet — mounts RouteMap, leaves linkSlugs off)"
  - "Plan 06 (LockDetail — sets linkSlugs=true post-lock)"
tech-stack:
  added: []
  patterns:
    - "lazy NEXT_PUBLIC_MAPBOX_TOKEN read (render-time, not import-hoist) for testability + resilience"
    - "per-call opt-in identity prop (linkSlugs) keeps a shared component blind-safe by default"
key-files:
  created:
    - apps/web/components/itinerary/RouteMap.tsx
    - apps/web/components/itinerary/__tests__/RouteMap.test.tsx
  modified:
    - apps/web/components/PlanTimeline.tsx
    - apps/web/components/__tests__/PlanTimeline.test.tsx
decisions:
  - "RouteMap returns null at 0 coords (no FallbackList) — the caller keeps its own placeholder (UI-SPEC E20)"
  - "Token read lazily via token() instead of module-scope const so vitest can set NEXT_PUBLIC_MAPBOX_TOKEN before the static map URL builds"
  - "Slug link uses next/link with a subtle shell-accent underline as the only affordance (no 'view venue' button — D-01)"
metrics:
  duration: ~12m
  completed: 2026-06-05
  tasks: 3
  files: 4
---

# Phase 7 Plan 04: Timeline + Map Building Blocks Summary

RouteMap (a Barbiecore-pink Mapbox static-image variant of ItineraryMap consuming `NightDetailStop[]`) plus two surgical PlanTimeline edits — coord deep-links (E20) and an opt-in `linkSlugs` prop (E21) that keeps the blind contract default-off — give downstream surfaces (Plans 05/06) reusable map + link primitives without re-implementing map or slug-link logic.

## What Was Built

### Task 1 — RouteMap.tsx (commit bd40162)
- New `apps/web/components/itinerary/RouteMap.tsx`: copies ItineraryMap's engine and changes exactly the three planned things — ACCENT `C2552B` → `E0218A` (bare hex, Mapbox-static-safe; Pitfall 5), `NightDetailStop[]` input instead of the planner `Stop`, and shell-token chrome (`rounded-3xl`, `bg-shell-base`, `ring-shell-accent`).
- Reuses verbatim: `encodePolyline`/`encodeSigned`, the `buildStaticMapUrl` shape (base style stays `mapbox/light-v11`), and the click-to-expand lightbox (Esc / body-scroll-lock / backdrop close).
- Returns `null` at 0 coords (no `FallbackList`) so the detail sheet keeps its own "short hop apart" placeholder.
- `<Image unoptimized>`; static PNG → reduced-motion friendly. Coords only — never a name or slug — so the map carries no identity (T-07-13).

### Task 2 — PlanTimeline coord href + opt-in linkSlugs (commit f08a34d)
- E20: the per-stop `map` href deep-links `?api=1&query={lat},{lng}` when both coords are present, else the existing name text-search. Icon/label/`target="_blank" rel="noopener noreferrer"` unchanged.
- E21/D-01: added `linkSlugs = false` to the `PlanTimeline` signature, threaded to `StopRow`. The stop NAME renders as a `next/link` to `/places/{place_slug}` ONLY when `linkSlugs === true && stop.place_slug`; otherwise the existing plain `<p>` (graceful degrade).
- Default-off preserves the blind contract on the feed sheet + offer surfaces (T-07-12); only the post-lock LockDetail (Plan 06) will set it true.

### Task 3 — Tests (RouteMap.test.tsx in bd40162, PlanTimeline.test.tsx in 5f2b6dd)
- `RouteMap.test.tsx`: URL built from ≥1 coord (pink hex, light-v11, pins, polyline), single-pin/no-path at exactly 1 coord, `null` at 0 coords, and a coord-incomplete stop (lat-only) is ignored.
- `PlanTimeline.test.tsx`: coord href vs name fallback; `linkSlugs=true`+slug → `/places/[slug]` link; `linkSlugs=true`+no slug → plain text; `linkSlugs=false` (default) → NO `/places` anchor (the blind-contract guard). Also added the missing `place_slug` field to the shared `stop()` test factory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lazy token read so the static URL builds under vitest**
- **Found during:** Task 1 (GREEN step).
- **Issue:** Reading `NEXT_PUBLIC_MAPBOX_TOKEN` into a module-scope `const TOKEN` (as ItineraryMap does) evaluates at import-hoist time, before the test's `beforeAll` sets the env var — so `buildStaticMapUrl` short-circuited to `null` and no `<img>` rendered (3 RouteMap tests failed).
- **Fix:** read the token via a `token()` accessor called inside `buildStaticMapUrl` (render-time) instead of a hoisted const. Also more resilient at runtime (env resolved when used).
- **Files modified:** apps/web/components/itinerary/RouteMap.tsx
- **Commit:** bd40162

**2. [Rule 1 - Bug] Test factory missing place_slug**
- **Found during:** Task 2/3.
- **Issue:** the pre-existing `PlanTimeline.test.tsx` `stop()` factory omitted `place_slug` (added to `NightDetailStop` in Plan 01) — a type hole that would surface once the new linkSlugs cases referenced it.
- **Fix:** added `place_slug: null` to the factory default.
- **Files modified:** apps/web/components/__tests__/PlanTimeline.test.tsx
- **Commit:** 5f2b6dd

## Verification

- `pnpm vitest run` RouteMap.test.tsx + PlanTimeline.test.tsx → 12/12 green.
- `pnpm typecheck` → 6/6 packages green (NightDetailStop.place_slug consumed).
- Default PlanTimeline render contains no `/places` anchor (asserted by the blind-contract guard test).

## Known Stubs

None. RouteMap and PlanTimeline are fully wired to the Plan-01 `NightDetailStop` contract; downstream mounting (RouteMap into the sheet, `linkSlugs` on LockDetail) is the explicit scope of Plans 05/06.

## Notes for Downstream

- Plan 05 mounts `<RouteMap stops={...} />` where the placeholder route viz sits (`NightDetailSheet.tsx:264-287`) and MUST leave `PlanTimeline` `linkSlugs` off.
- Plan 06 (LockDetail, post-lock) is the ONLY surface that passes `linkSlugs` to `PlanTimeline`.
- Visual-verify @420px (pink pins/route, lightbox, slug link on LockDetail) is deferred to the 07-09 gate per the wave contract.

## Self-Check: PASSED

All 4 plan files and the SUMMARY exist on disk; all 3 task commits (bd40162, f08a34d, 5f2b6dd) are present in git history.
