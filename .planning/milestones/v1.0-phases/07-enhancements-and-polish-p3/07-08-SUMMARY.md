---
phase: 07-enhancements-and-polish-p3
plan: 08
subsystem: web/my-nights
tags: [E25, archive, my-nights, frontend, ui]
requires:
  - date_instances.status (seeking/matched/active/completed/expired/cancelled)
  - existing /my-nights creator-scoped fetch + queue_entries tally
provides:
  - /my-nights upcoming/archive segment toggle (in-memory bucketing)
  - NightsSegments client leaf (reuses NightCard row + lifecycleLabel chip)
affects:
  - apps/web/app/my-nights/page.tsx (delegates render to the client segment)
tech-stack:
  added: []
  patterns:
    - client segment toggle over already-fetched SSR rows (no second DB query)
    - Map → plain object at the server/client boundary for serializable props
key-files:
  created:
    - apps/web/app/my-nights/NightsSegments.tsx
    - apps/web/app/my-nights/__tests__/archive-bucket.test.tsx
  modified:
    - apps/web/app/my-nights/page.tsx
decisions:
  - "D-02 scope: archive half of E25 only (skeleton is a sibling plan); no draft/typing/receipts/claim."
  - "Bucketing filters the existing creator_id-scoped fetch in memory — no new query, RLS unchanged (T-07-11)."
  - "Empty 'no nights at all' state moved into the client leaf (upcoming-empty = 'nothing posted yet'); archive-empty = funny copy."
metrics:
  duration: ~12m
  completed: 2026-06-05
---

# Phase 7 Plan 08: /my-nights Archive View Summary

E25 (D-02 scoped) archive view: a two-segment upcoming/archive toggle on `/my-nights` that buckets the host's own nights in memory by `date_instances.status`, reusing the existing NightCard row + corner chip with no new card design.

## What Shipped

- **NightsSegments.tsx** (new `'use client'` leaf): a `role="tablist"` toggle with `upcoming` (default) / `archive` segments. Buckets the already-fetched `nights` prop in memory — `upcoming = seeking|matched|active`, `archive = completed|expired|cancelled`. Exports `bucketForStatus()` so the contract is directly testable. Active segment uses `bg-shell-accent text-white` (the app's selected-state convention), `min-h-[44px]` tap targets, `focus-visible:ring-4 ring-shell-accent/40`, `motion-reduce` safe.
- **page.tsx**: stays an SSR server component (creator-scoped fetch + queue tally unchanged). The night-card render + the two empty states moved into the client leaf. `counts` Map is serialized to a plain object (`Object.fromEntries`) before crossing the server/client boundary. Added `expired` to `lifecycleLabel` so archived expired nights read `expired` on the chip.
- **archive-bucket.test.tsx** (new): a 6-status fixture set asserting both buckets, the default-upcoming selection, the switch-to-archive behavior, the verbatim empty-archive copy, and the >=44px tap-target contract. 7 tests green; the prior 9 `page.test.tsx` tests still pass (16 total).

## Copy (UI-SPEC verbatim)

- Tab labels: `upcoming` (default) / `archive`, lowercase.
- Empty archive heading: `nothing in the rear-view yet`
- Empty archive body: `your past nights and matches land here once they wrap.`

All lowercase, dry, no em-dashes.

## Verification

- `pnpm vitest run apps/web/app/my-nights/__tests__/archive-bucket.test.tsx apps/web/app/my-nights/__tests__/page.test.tsx` → 16 passed.
- `tsc --noEmit -p apps/web/tsconfig.json` → exit 0 (no type drift from the refactor).
- No new DB query added — the existing `creator_id`-scoped fetch is reused (threat T-07-11 holds; RLS untouched).
- Visual-verify @420px is the 07-09 phase gate, not this plan; markup written to spec.

## Deviations from Plan

**None of consequence.** The plan's "small client toggle or client wrapper" left the structure open; I chose the wrapper approach (extract the list + both empty states into the leaf) because the night-card JSX uses only client-safe deps (`Image`, `LocalTime`, `NightCardActions`, `coverImageForNight`) and the empty-state branching is cleanest co-located with the bucket logic. The server page keeps all data fetching. One small correctness add (Rule 2): `lifecycleLabel` gained an explicit `expired` case so archived expired nights show `expired` rather than the raw status — they were previously unreachable on this surface and now are.

## Known Stubs

None. The toggle is wired to real `date_instances.status` over the live creator-scoped fetch.

## Self-Check: PASSED

- FOUND: apps/web/app/my-nights/NightsSegments.tsx
- FOUND: apps/web/app/my-nights/__tests__/archive-bucket.test.tsx
- FOUND: apps/web/app/my-nights/page.tsx (modified)
- FOUND commit 3202fad (feat — toggle)
- FOUND commit 3fa27d1 (test — archive-bucket)
