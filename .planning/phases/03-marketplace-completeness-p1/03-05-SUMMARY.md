---
phase: 03-marketplace-completeness-p1
plan: 05
subsystem: dating-loop-ui
tags: [e13, plan-render, rls-read, offer-detail, lock-detail, blind-safe]
requires:
  - "apps/web/components/PlanTimeline.tsx — shared blind-safe stop timeline (from 03-04)"
  - "normalizeNightDetailStops (packages/api-client/src/feed.ts)"
  - "date_instances_select_offer_recipient RLS policy (migration 127500)"
  - "itineraries_readable_by_id USING(true) (migration 20260419202912)"
provides:
  - "the matched night's full itinerary now renders on /offers/[offerId] and /matches/[lockId]"
  - "the SSR two-step RLS read path (date_instances → itinerary_id → itineraries.stops, normalized) used by both screens"
  - "supabase/tests/e13_plan_read.sql — RLS read test (recipient reads stops; stranger denied)"
affects:
  - "Phase-3 payoff: every match has a real plan attached"
tech-stack:
  added: []
  patterns: ["SSR two-step RLS read (gated instance → public-by-id itinerary)", "normalize-at-the-loader-boundary (PlanTimeline never re-normalizes)"]
key-files:
  created:
    - supabase/tests/e13_plan_read.sql
  modified:
    - apps/web/app/offers/[offerId]/OfferDetail.tsx
    - apps/web/app/offers/[offerId]/page.tsx
    - apps/web/app/offers/[offerId]/__tests__/OfferDetail.test.tsx
    - apps/web/app/offers/[offerId]/__tests__/a11y.test.tsx
    - apps/web/app/matches/[lockId]/LockDetail.tsx
    - apps/web/app/matches/[lockId]/page.tsx
    - apps/web/app/matches/[lockId]/__tests__/LockDetail.test.tsx
    - apps/web/app/matches/lock-view.ts
    - packages/api-client/src/index.ts
decisions:
  - "Both loaders read itineraries.stops via the existing RLS path (date_instances offer-recipient/lock-party → itinerary_id → itineraries USING(true)), normalize with normalizeNightDetailStops at the loader boundary, and hand already-normalized NightDetailStop[] to PlanTimeline — which never re-normalizes (D-12 / 03-04 lossy-renormalization decision). NO new RPC; NOT get_night_detail (blind/pre-swipe-only, T-03-16)."
  - "host.bio fully removed (F#5): the prop, its render branch, and the bio:null hardcode in the offer loader. profiles has no bio column — the dead branch never rendered anything."
  - "normalizeNightDetailStops re-exported from @after5/api-client (was only in ./feed) so the server loaders can import it. Blocking issue (Rule 3) — the loaders need it."
metrics:
  duration: ~35m
  completed: 2026-06-03
---

# Phase 3 Plan 05: Render the Matched Plan (E13) Summary

Delivered the Phase-3 payoff — every match now shows its real plan. Both `/offers/[offerId]` (OfferDetail) and `/matches/[lockId]` (LockDetail) render the matched night's full itinerary via the shared `PlanTimeline`, loaded through the existing RLS read path (no new RPC). Fixed the offer screen's labelled-but-empty "the night" section, deleted the dead `host.bio` branch, and kept the photo-led reveal ordering (D-07) unchanged.

## What Was Built

- **OfferDetail (`/offers/[offerId]`):** The "the night" section now renders the full timeline via `<PlanTimeline stops={stops} accent={vibePalette(vibeTags).accent} vibeTags={vibeTags} />`, keeping the eyebrow, the date line, and `ExpiryCountdown`. Empty/failed stops degrade to `the full plan unlocks here.` — never a blank labelled section. `host.bio` removed from props + render (F#5). The loader (`page.tsx`) extends the existing instance embed with `itinerary_id`, then does the second RLS read — `itineraries.select('stops, vibe_tags').eq('id', instance.itinerary_id)` — and `normalizeNightDetailStops(it?.stops)` before passing. The `bio:null` hardcode is gone.
- **LockDetail (`/matches/[lockId]`):** A new `the night` `<section>` (eyebrow `text-shell-accent` + `PlanTimeline`) sits between the `message {name}` block and the cancel/rate actions. Missing stops degrade to `plan's being put together.`. `LockDetailProps` gains optional `stops`/`vibeTags`. `lock-view.ts`'s instance shape gains `itinerary_id`; `[lockId]/page.tsx` extends the instance embed with `itinerary_id` and does the same two-step RLS read.
- **`packages/api-client/src/index.ts`:** re-exports `normalizeNightDetailStops` from `./feed` so the server loaders can import it.
- **`supabase/tests/e13_plan_read.sql`:** RLS read test for the two-step path. POSITIVE — an offer-recipient reads the instance + `itinerary_id` + the 2-stop forked plan; NEGATIVE — a stranger cannot read the instance; REGRESSION — the creator still reads their own; plus a post-lock case (a lock participant reads instance + stops).
- **Tests:** OfferDetail RTL extended (plan renders in "the night" + empty-stops degrade copy + no-bio path); the offer a11y base updated for the new prop shape (populated plan); LockDetail RTL extended (plan render + degrade copy).

## How the Read Path Works

```
date_instances (RLS: offer-recipient policy 127500 / lock-party) → read itinerary_id COLUMN
   → itineraries.select('stops, vibe_tags').eq('id', itinerary_id)   (RLS: itineraries_readable_by_id USING(true))
   → normalizeNightDetailStops(raw stops)   [loader boundary — PlanTimeline never re-normalizes]
   → PlanTimeline
```

No new RPC. NOT `get_night_detail` (blind/pre-swipe-only — would risk a wrong-row blind read, T-03-16).

## Verification

- `pnpm --filter web test -- offers` — **43/43 green** (incl. 2 new plan tests + no-bio + a11y populated-plan).
- `pnpm --filter web test -- matches` — **38/38 green** (incl. 2 new LockDetail plan tests).
- `pnpm db:reset` → `pnpm db:types` (no diff) → `pnpm db:test` (EXIT=0, e13_plan_read.sql 5 cases pass) → `pnpm -w typecheck` (**6/6 tasks successful**). NO prod apply / db:push / edge deploy (gated).
- grep: `PlanTimeline` used in OfferDetail (3 refs) + LockDetail; `itinerary_id` in both loaders + lock-view; `bio` gone from OfferDetail.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-exported normalizeNightDetailStops from @after5/api-client**
- **Found during:** Task 1 (the server loader needs the normalizer; it was exported only from `./feed`, not the package index).
- **Fix:** Added `normalizeNightDetailStops` to the named export from `./feed` in `packages/api-client/src/index.ts`. No behavior change — purely makes an existing function importable by the server pages.
- **Files modified:** packages/api-client/src/index.ts
- **Commit:** 199875a

**2. [Rule 3 - Blocking] Fixed the offer a11y test for the new prop shape**
- **Found during:** Task 1 (removing `host.bio` and adding required `stops`/`vibeTags` to `OfferDetailProps` broke `__tests__/a11y.test.tsx`, which passed `bio` and omitted the new props — a typecheck break directly caused by this task).
- **Fix:** Updated the a11y `base` props — dropped `bio`, added a populated `stops` + `vibeTags` (so the a11y sweep also covers the rendered timeline), and stubbed `next/image`.
- **Files modified:** apps/web/app/offers/[offerId]/__tests__/a11y.test.tsx
- **Commit:** 199875a

## Threat Model Compliance

- **T-03-14 (candidate reads a plan they weren't offered):** mitigated — `date_instances_select_offer_recipient` gates the instance read; `e13_plan_read.sql` asserts a stranger is denied (zero rows).
- **T-03-15 (itineraries USING(true) over-broad read):** accepted per plan — legacy posture; the privacy boundary is the unguessable UUID + the gated instance read. Out of scope this phase.
- **T-03-16 (wrong-row read via blind RPC):** mitigated — both loaders use the explicit `date_instances → itinerary_id → itineraries` path, NOT `get_night_detail`.
- **T-03-SC (package installs):** zero new packages.

## Known Stubs

None. Both screens render real stops from the loader; the degrade copy (`the full plan unlocks here.` / `plan's being put together.`) is the intentional empty-state, not a stub.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. This plan adds zero DDL; it reads existing tables via existing RLS policies.

## Follow-ups / Recommended

- **Visual-verify (plan `<human-check>`):** forced-local Playwright at 420px — confirm the offer "the night" renders the plan timeline with reveal ordering unchanged, and the lock "the night" sits below the message block / above cancel. Per 03-UI-SPEC §E13. Recommended before the phase's batched push (visual-verify standing rule).
- The `itineraries USING(true)` read remains flagged for future hardening (T-03-15), out of scope this phase.
