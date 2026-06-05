---
phase: 06-trust-and-safety-p2
plan: 01
subsystem: database
tags: [reliability, definer-rpc, postgres, react, badge, profilecard, vitest]

requires:
  - phase: 05-progressive-reveal-p2
    provides: RevealModal + ProfileCard reveal surface, public_profile_card view, close_rating_window hook
provides:
  - computeReliability pure scoring function (0-100 integer percent, null until 3 dates)
  - recompute_reliability(uuid) DEFINER RPC + close_rating_window reliability hook (gated migration)
  - reliability pill on the revealed ProfileCard (blush "new here" / sage-ticked "{score}% · reliable")
  - e17 SQL assertion script (no_show feed + idempotent recompute) authored for 06-05
affects: [06-05-phase-gate, trust-and-safety, reliability-backfill]

tech-stack:
  added: []
  patterns:
    - "Pure-fn-mirrors-SQL: computeReliability weights copied verbatim into the SQL RPC"
    - "no_show-authoritative aggregation (count from locks.status, exclude already-rated locks)"

key-files:
  created:
    - packages/business/src/reliability.ts
    - packages/business/src/reliability.test.ts
    - supabase/migrations/20260605120000_e17_recompute_reliability.sql
    - supabase/tests/e17_recompute_reliability.sql
  modified:
    - packages/business/src/index.ts
    - apps/web/components/ProfileCard.tsx
    - apps/web/components/__tests__/ProfileCard.test.tsx
    - apps/web/app/matches/[lockId]/RevealModal.tsx
    - apps/web/app/matches/[lockId]/page.tsx
    - apps/web/app/matches/lock-view.ts

key-decisions:
  - "Reliability weights: showed_up 80 + on_time 20 (clean attended date = 100); cancelled_with_notice 50 is a RECOVERY credit only on a no-show; unsafe_or_disrespectful -100 wipes the date to 0; no_show date = 0"
  - "no_show authoritative: counted from locks.status='no_show', excluding any lock already rated for the ratee — each lock lands in exactly one bucket (no double-count)"
  - "SOFT posture (D-02): recompute_reliability writes ONLY profiles.reliability_score — no enforcement, no status change, no bans"
  - "NULL score until >=3 total (rated + no_show) dates keeps badge_is_new true (the 'new here' treatment)"
  - "Migration GATED: local apply + advisor + SQL script execution deferred to plan 06-05; prod untouched"

patterns-established:
  - "Pure scoring fn (reliability.ts) is the testable spec; the SQL RPC mirrors its weights 1:1"
  - "Reliability pill driven by badgeFor() — verified-gated, blush new-member vs sage-tick established, aria-label both states, no red"

requirements-completed: [REQ-E17]

duration: 6min
completed: 2026-06-05
---

# Phase 6 Plan 01: E17 Reliability Summary

**A verified user earns a warm, visible reliability signal — a weighted % computed from their match_ratings (+ no_show locks) when the rating window closes, surfaced as a non-punitive ProfileCard pill that encourages new members ("new here") rather than punishing them.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-05T05:27:49Z
- **Completed:** 2026-06-05T05:33:08Z
- **Tasks:** 4 / 4
- **Files modified:** 10 (4 created, 6 modified)

## Accomplishments
- Pure `computeReliability` scoring function with locked weights the SQL mirrors verbatim; 7 unit cases green.
- `recompute_reliability(uuid)` DEFINER RPC (search_path pinned, revoke-all, aggregate-only) hooked into `close_rating_window` for both lock parties; no_show counted from `locks.status`, never double-counted.
- Reliability pill on the revealed ProfileCard: blush "new here" (+ "no rated dates yet", no number) vs neutral "{score}% · reliable" with a tiny sage tick; aria-label in both states, no red; 6 component cases green.
- e17 SQL assertion script authored (no_show feed, established, new-member, idempotent double-close) for the 06-05 local-apply run.

## Task Commits

Each task was committed atomically:

1. **Task 1: computeReliability pure scoring fn (TDD)** - `a33d529` (feat) — RED test authored + verified failing, then GREEN implementation
2. **Task 2: recompute_reliability RPC + close_rating_window hook** - `b160f15` (feat)
3. **Task 3: reliability pill on ProfileCard + prop wiring (TDD)** - `91c771e` (feat) — RED extended test, then GREEN pill + wiring
4. **Task 4: e17 SQL assertion script** - `4132459` (test)

## Files Created/Modified
- `packages/business/src/reliability.ts` - Pure `computeReliability(dates, threshold)`; weights + overlap rule; the SQL spec.
- `packages/business/src/reliability.test.ts` - 7 cases: all-good high, 3 no_show=0, <3=null, unsafe penalty/floor, badgeFor mapping.
- `packages/business/src/index.ts` - Re-export `computeReliability` + `ReliabilityDate`.
- `supabase/migrations/20260605120000_e17_recompute_reliability.sql` - `recompute_reliability(uuid)` DEFINER + `close_rating_window` CREATE OR REPLACE recomputing both parties. GATED, not applied.
- `supabase/tests/e17_recompute_reliability.sql` - SQL assertions (no_show feed, established, new-member, idempotent), RAISE on mismatch.
- `apps/web/components/ProfileCard.tsx` - `verification` + `reliability_score` props; the reliability pill via `badgeFor()`.
- `apps/web/components/__tests__/ProfileCard.test.tsx` - 3 added pill cases (new-here no %, established % + aria-label, aria-label both states).
- `apps/web/app/matches/[lockId]/RevealModal.tsx` - Threads `verification` + `reliability_score` from `person` into ProfileCard.
- `apps/web/app/matches/[lockId]/page.tsx` - Loader selects `verification, reliability_score` for both lock parties.
- `apps/web/app/matches/lock-view.ts` - `PartyProfile` carries `verification` + `reliability_score`.

## Verification
- `pnpm vitest run packages/business/src/reliability.test.ts` — 7/7 green
- `pnpm vitest run apps/web/components/__tests__/ProfileCard.test.tsx` — 6/6 green
- `pnpm --filter web exec tsc --noEmit` — clean
- Migration grep gate (2× `perform recompute_reliability`, `set search_path=public`, `revoke all on function recompute_reliability`) — passes
- e17 SQL assertion script authored (executed in 06-05)

## Deviations from Plan
None — plan executed exactly as written. One in-task refinement (not a plan deviation): the unit-spec weights were tuned during TDD so a clean attended date (`showed_up + on_time`, not cancelled) scores 100 rather than 80 — `cancelled_with_notice` became a recovery credit on a no-show instead of an additive bonus. The SQL RPC mirrors the final weights verbatim.

## Gated / Deferred
- Local `supabase db reset`/apply + Supabase security advisor for `20260605120000_e17_recompute_reliability.sql` — **deferred to plan 06-05** (per plan + critical rules). Prod (`ufufmcpnysvwtutpbian`) untouched.
- `supabase/tests/e17_recompute_reliability.sql` is authored but EXECUTED in 06-05 against the local stack after migrations apply.
- Visual-verify @420px of the reliability pill — deferred to the 06-05 phase gate.

## Known Stubs
None. The pill is fully wired to real loader data (`profiles.verification` + `profiles.reliability_score`); reliability_score is genuinely all-NULL in prod today (no aggregation has run), which correctly renders as the "new here" treatment until the window-close recompute populates it forward.

## Self-Check: PASSED
- Files: all 5 spot-checked exist (reliability.ts, reliability.test.ts, migration, SQL test, ProfileCard.tsx)
- Commits: a33d529, b160f15, 91c771e, 4132459 all present in git log
