# Phase 3 — Deferred Items (out-of-scope discoveries)

## From 03-04 (PlanTimeline extraction, Wave 1)

- **`pnpm -w typecheck` fails in `app/dates/[slug]/interested/InterestedList.tsx` + `interested/page.tsx`** with `Type '"passed_by_host"' is not assignable to ...` on the `HostCandidate` status union.
  - **Cause:** mid-wave drift between the `queue_status` enum / generated `packages/types/src/database.ts` and the `HostCandidate` type used by 03-02's `InterestedList`. The `passed_by_host` enum value (E12) is owned by 03-01 (DB + `pnpm db:types` regen) and 03-02 (InterestedList). NOT touched by 03-04.
  - **Scope:** out of scope for 03-04 (pure PlanTimeline component extraction — no DB, no enum, no InterestedList edits). PlanTimeline + NightDetailSheet + the new test are type-clean (`typecheck` reports zero errors outside those two parallel-plan files).
  - **Owner:** 03-01 (regen `database.ts` after the `passed_by_host` enum migration) / 03-02 (reconcile `HostCandidate` status union). Resolves once 03-01's type regen lands.
