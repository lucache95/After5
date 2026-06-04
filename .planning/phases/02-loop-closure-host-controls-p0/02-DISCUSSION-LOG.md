# Phase 2: Loop Closure & Host Controls (P0) — Discussion Log

**Date:** 2026-06-03
**Mode:** discuss (batched, recommendations-first; config = YOLO)

## Scouting before discussion
Confirmed in code: `lock_status` enum already has `completed`/`no_show` but no RPC reaches them; `close_rating_window` only stamps `rating_closed_at`. `cancel_night`/`update_night`/`reject_candidate` = 0 migration defs (genuinely missing). `match_ingest_interest` (20260527126200) exists + record_swipe invokes it, but dispatches no `interest_received`. Dead job handlers have a `handlers_rpc_fail_closed_test.ts` → poison-loop partly mitigated (fail-closed).

## Decisions
- **E5 completion model** — Hybrid: cron auto-complete after end-time+grace + either-party no-show override (uses existing `no_show` enum). Past-dated seeking nights auto-swept. Aggregation deferred to E17/Phase 6. → CONTEXT D-01/02/03.
- **E6/E7 cancel+edit** — Soft cancel (reversible, hidden, data kept) + notify interested candidates on cancel and on material (time/venue) edits; hard delete reserved. Definer RPCs re-checking creator = auth.uid(). → CONTEXT D-04/05/06.
- **E9 poison-loop** — Remove dead handlers + enqueue paths now; rebuild safety flows in E19/Phase 6; sequence E9 before E5 schedules cron. → CONTEXT D-08.
- **E8 interest notifs** — Per-interest in-app (deep-linked to interested list) + throttled email/push digest on high volume. → CONTEXT D-07.

## Claude's discretion
Grace-buffer durations, cron cadence, throttle threshold, no-show RPC shape, minimal cancel/edit UI affordances.

## Deferred (redirected)
reliability aggregation → E17/Phase 6; safety-flow rebuild → E19/Phase 6; reject_candidate → E12/Phase 3; hard delete → out of scope.
