---
phase: 07-enhancements-and-polish-p3
plan: 07
subsystem: dating-loop-frontend
tags: [E24, standby, queue, inbox, withdraw, vaul, sonner, RLS, blind-contract]
requires:
  - withdraw_interest DEFINER RPC (migration 20260606140200, Wave 1 / 07-03)
  - withdrawInterest wrapper in packages/api-client/src/feed.ts (07-01)
  - queue_entries + queue_candidate_read_own RLS (20260525120500)
provides:
  - StandbyCard (Tier-1 shell standby card: position + neutral withdraw + vaul confirm)
  - StandbyList (candidate-facing read of own interested queue rows)
  - /inbox candidate standby section mount
affects:
  - apps/web/app/inbox/page.tsx (empty-state check now folds in standby head-count)
  - packages/api-client/src/index.ts (withdrawInterest re-export)
  - apps/web/lib/after5/client.ts (withdrawInterest re-export)
tech-stack:
  added: []
  patterns:
    - vaul confirm + sonner toast mirroring NightCardActions/LockDetail cancel pattern
    - blind-contract identity-free night label (no date_instances read pre-offer)
key-files:
  created:
    - apps/web/components/StandbyCard.tsx
    - apps/web/app/inbox/StandbyList.tsx
    - apps/web/components/__tests__/StandbyCard.test.tsx
  modified:
    - apps/web/app/inbox/page.tsx
    - packages/api-client/src/index.ts
    - apps/web/lib/after5/client.ts
decisions:
  - "Blind-safe night label: a candidate with a plain interested row has NO RLS read on date_instances/itineraries (creator/offer-recipient only, 20260527127500), so StandbyCard shows an identity-free label ('a night you slid in on') rather than the night title — both honors T-07-16 and avoids a null join."
  - "Empty-state honesty: inbox now head-counts the candidate's pending-interest rows so a queue-only inbox renders the standby section instead of 'quiet in here'."
  - "withdrawInterest is re-exported through api-client index + app client.ts (it existed in feed.ts but was unexported) so the StandbyCard import resolves at typecheck."
metrics:
  duration_min: 8
  completed: 2026-06-05
  tasks: 3
  files: 6
---

# Phase 7 Plan 7: Candidate Standby/Waitlist UI (E24) Summary

E24 candidate-side standby UI: a Tier-1 shell `StandbyCard` (queue position line + soft no-promise sub-line + a neutral `pull my interest` control behind a vaul confirm that calls the `withdraw_interest` RPC wrapper and toasts via sonner) mounted on `/inbox` via `StandbyList`, which SSR-reads the candidate's own `interested` queue rows under a `your queue` eyebrow and stays hidden when empty.

## What Shipped

- **StandbyCard.tsx** — `'use client'` Tier-1 shell card. `rank=1` -> `you're next in line`; `rank>1` -> `you're #{rank} in line`; soft sub-line `if the spot opens up, you're up.` (no auto-promotion promise). The `pull my interest` control is a neutral secondary button (`border-2 border-shell-ink/20 text-shell-ink/70`, >=44px, focus ring) — not accent, not red. Tapping it opens a vaul confirm (title `pull your interest?`, body `you'll drop off this night's list. you can always slide back in later.`, button `yep, pull it`); confirm calls `withdrawInterest(client, { instance_id })`, on success toasts `pulled. you're off this one.` + `router.refresh()`, on error toasts a dry mapped line.
- **StandbyList.tsx** — server component reading `queue_entries.select('date_instance_id, status, rank')` filtered `candidate_id = user.id AND status = 'interested'` (RLS `queue_candidate_read_own` double-enforces). One `StandbyCard` per row under a `your queue` eyebrow; returns null when empty.
- **/inbox mount** — `StandbyList` mounts above `ActivityList`; an exact-count head query of the candidate's pending-interest rows folds into the `bothEmpty` check so a queue-only inbox doesn't read "quiet in here".
- **withdrawInterest re-export** — added to `packages/api-client/src/index.ts` and `apps/web/lib/after5/client.ts`.

## Verification

- `pnpm vitest run apps/web/components/__tests__/StandbyCard.test.tsx` — 8/8 green (rank=1, rank>1, sub-line, neutral control, confirm copy, withdraw-success path, error toast, a11y).
- `pnpm vitest run apps/web/app/inbox/__tests__` — ActivityList 4/4 still green (no regression).
- `pnpm typecheck` — green across all 6 packages.

## TDD Gate Compliance

- RED: `test(07-07)` commit `5c3133a` — StandbyCard test failed (module absent).
- GREEN: `feat(07-07)` commit `361993a` — component + exports, 8/8 pass.
- REFACTOR: none needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] withdrawInterest not re-exported from the app import surface**
- **Found during:** Task 1 (StandbyCard imports `withdrawInterest` from `@/lib/after5/client`).
- **Issue:** `withdrawInterest` existed in `packages/api-client/src/feed.ts` (added 07-01) but was never re-exported through `packages/api-client/src/index.ts` or `apps/web/lib/after5/client.ts`, so the StandbyCard import would not resolve.
- **Fix:** Added `withdrawInterest` to both re-export lists (no new wrapper — the Wave-1 wrapper is reused verbatim, per the prompt directive).
- **Files modified:** packages/api-client/src/index.ts, apps/web/lib/after5/client.ts
- **Commit:** 361993a

**2. [Rule 2 - Correctness] Standby label honors the blind contract**
- **Found during:** Task 2.
- **Issue:** The plan text suggested looking up "a night label for display". A candidate with a plain `interested` row has NO RLS read on `date_instances`/`itineraries` (creator/offer-recipient only). Joining for a title would return null AND risk leaking host identity (T-07-16).
- **Fix:** StandbyCard renders an identity-free label (`a night you slid in on`) sourced from the queue row alone — no night-detail join.
- **Files modified:** apps/web/app/inbox/StandbyList.tsx
- **Commit:** b78e2c4

## Threat Coverage

- **T-07-14 (info disclosure, cross-candidate rows):** mitigated — explicit `candidate_id = user.id` filter + `queue_candidate_read_own` RLS.
- **T-07-15 (EoP, withdraw another user's interest):** mitigated — `withdrawInterest` passes `p_actor = actorId(client)`; the RPC's `auth.uid()` gate (07-03) is the boundary.
- **T-07-16 (host identity leak):** mitigated — StandbyCard renders only the candidate's own rank/status + a generic identity-free label; no date_instances/itineraries read occurs.

## Known Stubs

None. The night label is intentionally generic (blind contract), not a stub awaiting wiring — a candidate cannot read the title pre-offer by design.

## Notes / Deferred

- Visual-verify @420px is deferred to the 07-09 gate (per prompt + 07-CONTEXT).
- Promotion logic (offer-expiry -> standby) remains deferred (07-CONTEXT §Deferred); the sub-line makes no promise.

## Self-Check: PASSED

- Files: StandbyCard.tsx, StandbyList.tsx, StandbyCard.test.tsx all present.
- Commits: 5c3133a (RED test), 361993a (component+exports), b78e2c4 (read view+mount) all in git log.
