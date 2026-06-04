---
phase: 03-marketplace-completeness-p1
plan: 04
subsystem: ui-components
tags: [extraction, plan-timeline, blind-safe, dating-loop]
requires:
  - "StopRow/StopTime in apps/web/app/feed/NightDetailSheet.tsx (extraction source)"
  - "normalizeNightDetailStops + NightDetailStop type (packages/api-client/src/feed.ts)"
provides:
  - "apps/web/components/PlanTimeline.tsx — shared blind-safe stop timeline (named export PlanTimeline)"
affects:
  - "03-05 (OfferDetail + LockDetail consume PlanTimeline)"
tech-stack:
  added: []
  patterns: ["component extraction (verbatim, behavior-preserving)", "already-normalized stops contract (caller normalizes)"]
key-files:
  created:
    - apps/web/components/PlanTimeline.tsx
    - apps/web/components/__tests__/PlanTimeline.test.tsx
  modified:
    - apps/web/app/feed/NightDetailSheet.tsx
decisions:
  - "PlanTimeline accepts already-normalized NightDetailStop[] and does NOT re-normalize — re-normalizing a NightDetailStop[] is lossy (the normalizer reads source keys like estimated_cost_pp, not cost_pp), which would silently drop cost/etc. Callers reading raw itineraries.stops JSON (E13 loaders in 03-05) normalize BEFORE passing. This makes the extraction byte-identical to the prior inline loop."
metrics:
  duration: ~25m
  completed: 2026-06-03
---

# Phase 3 Plan 04: Extract Shared PlanTimeline Summary

Extracted the blind-safe per-stop timeline (StopRow + StopTime) from the feed's NightDetailSheet into a shared `PlanTimeline` component, consumed behavior-preservingly so the feed sheet renders identically and the E13 offer/match screens (03-05) can render the matched plan from one canonical source.

## What Was Built

- **`apps/web/components/PlanTimeline.tsx`** (named export `PlanTimeline`): an `<ol>` of numbered blind-safe `StopRow`s — numbered photo thumb + dashed connector + name + `neighborhood · type · time` + one-line desc with "more" + `$pp` (tabular cost) + name-query map link. `StopRow` + `StopTime` moved **verbatim** from NightDetailSheet (semantics-preserving). NO `/places/[slug]` link, NO reservation_url — the identity-bearing `components/itinerary/StopCard.tsx` was deliberately NOT used (T-03-13). Empty `stops` array renders `null` (caller owns degrade copy).
- **`apps/web/app/feed/NightDetailSheet.tsx`**: rewired to render `<PlanTimeline stops={stops} accent={pal.accent} vibeTags={night.vibe_tags} />` in place of the inline `<ol>` loop; deleted the duplicated private `StopRow`/`StopTime` and now-unused imports (`imageForStop`, `NightDetailStop` type). The `stops.length > 0` section guard and all surrounding markup are unchanged — identical render.
- **`apps/web/components/__tests__/PlanTimeline.test.tsx`** (RTL): a multi-stop array renders one `<li>` per stop with names + cost (`$22 pp` / `free` / `$14 pp`); an empty array renders zero rows (no crash); a stop with neighborhood/type renders meta.

## Contract

`PlanTimeline({ stops: NightDetailStop[], accent: string, vibeTags: string[] | null })`. `stops` must already be normalized — callers that read raw `itineraries.stops` JSON (the 03-05 E13 loaders) run `normalizeNightDetailStops` before passing; `get_night_detail` already returns normalized stops. `accent` is `vibePalette(vibeTags).accent`.

## Verification

- `pnpm --filter web test -- PlanTimeline` — **3/3 green**.
- `pnpm -w typecheck` — **green for all files in this plan's scope** (PlanTimeline, NightDetailSheet, test). The only `typecheck` failures in the workspace are in `app/dates/[slug]/interested/InterestedList.tsx` + `interested/page.tsx` (`passed_by_host` enum drift) — out-of-scope parallel-plan work owned by 03-01 (type regen) / 03-02; logged to `deferred-items.md`. Confirmed via `typecheck 2>&1 | grep 'error TS' | grep -v InterestedList` → no errors.
- grep: `PlanTimeline` exported and imported by NightDetailSheet; private `StopRow`/`StopTime` deleted from NightDetailSheet (zero remaining refs).
- DB untouched: no migration, no `db:reset`, no `db:test` run (03-01 owns the DB this wave).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed double-normalization that would silently drop stop cost/fields**
- **Found during:** Task 1 (RED→GREEN — the `$22 pp` assertion failed because cost rendered as absent).
- **Issue:** The plan action said "Normalize incoming stops with `normalizeNightDetailStops`" inside PlanTimeline. But PlanTimeline's prop type is already-normalized `NightDetailStop[]`, and `normalizeNightDetailStops` reads SOURCE keys (`estimated_cost_pp`, `place_name`, `place_type`) — re-running it on a `NightDetailStop` (which has `cost_pp`, `name`, `type`) returns nulls for those fields. This would have silently blanked `$pp`/cost on EVERY stop in the feed sheet — a visual regression and a correctness bug.
- **Fix:** PlanTimeline consumes `stops` as-is (no re-normalization), matching the original NightDetailSheet inline loop exactly. Normalization stays at the data-loading boundary: `get_night_detail` already normalizes; the 03-05 E13 loaders normalize raw `itineraries.stops` before passing. Documented in the component JSDoc + the decisions frontmatter.
- **Files modified:** apps/web/components/PlanTimeline.tsx
- **Commit:** 74f88db

## Threat Model Compliance

- **T-03-12 (malformed stop JSON):** mitigated at the loader boundary (`normalizeNightDetailStops`); PlanTimeline renders zero rows for an empty array (tested) — never crashes.
- **T-03-13 (venue-slug leak):** mitigated — used the NightDetailSheet StopRow shape (map link is a `google.com/maps/search?query=<name>` name-query, NO `/places/[slug]`); `StopCard.tsx` deliberately not imported.
- **T-03-SC (package installs):** zero new packages.

## Known Stubs

None. PlanTimeline is fully wired (feed sheet consumes it live).

## Follow-ups / Recommended

- **Visual-verify (plan `<human-check>`):** forced-local Playwright screenshot of the feed NightDetailSheet timeline vs pre-extraction. The extraction is a verbatim move (provably identical markup + identical already-normalized `stops` + identical guard), so no visual delta is expected; a confirming screenshot is recommended before the phase's batched push per the visual-verify standing rule.
- The `passed_by_host` typecheck errors clear once 03-01 regenerates `packages/types/src/database.ts`.

## Self-Check: PASSED

- FOUND: apps/web/components/PlanTimeline.tsx
- FOUND: apps/web/components/__tests__/PlanTimeline.test.tsx
- FOUND (modified): apps/web/app/feed/NightDetailSheet.tsx
- FOUND: commit 74f88db
