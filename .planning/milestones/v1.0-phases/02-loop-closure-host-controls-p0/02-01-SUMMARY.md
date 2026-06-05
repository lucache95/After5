---
phase: 02-loop-closure-host-controls-p0
plan: 01
subsystem: process-jobs
tags: [job-queue, edge-functions, deno, cleanup, poison-loop, E9]
requires: []
provides:
  - "process-jobs HANDLERS table with the 6 dead poison-loop handlers removed"
  - "Synchronized Deno test suite (handlers_test.ts + handlers_rpc_fail_closed_test.ts)"
affects:
  - "Plan 02-03 (E5 cron scheduling) — E9 cleanup now lands first per D-08/D-11"
tech-stack:
  added: []
  patterns:
    - "Fail-closed job dispatch: if(!handler) throw + raise_admin_alert('job_missing_rpc') (index.ts, untouched) is the only safety floor needed for orphan enqueues"
key-files:
  created:
    - .planning/phases/02-loop-closure-host-controls-p0/02-01-SUMMARY.md
  modified:
    - supabase/functions/process-jobs/handlers.ts
    - supabase/functions/process-jobs/handlers_test.ts
    - supabase/functions/process-jobs/handlers_rpc_fail_closed_test.ts
decisions:
  - "Did NOT drop any job_type Postgres enum value (destructive in PG); orphan enum values are harmless — nothing enqueues them and the runner fails closed"
  - "Did NOT edit the p2_jobs_rpcs.sql test fixture that uses 'safety_checkin' as an arbitrary type label for an enqueue-dedup idempotency test — it is not a live producer and is out of this deno-only plan's scope (db:reset owned by parallel plan 02-02)"
metrics:
  duration: ~2m
  completed: 2026-06-04
---

# Phase 2 Plan 01: Remove Dead Poison-Loop Job Handlers (E9) Summary

Removed the 6 dead `process-jobs` handlers that read as real but call missing RPCs (latent poison-loops) and pruned the two coupled Deno test files in lockstep, leaving only the runner's `if(!handler) throw` + `job_missing_rpc` fail-closed net as the safety floor for orphan enqueues.

## What Was Built

**Task 1 — `handlers.ts` (commit `0f929ff`):**
Deleted exactly the 6 dead `HANDLERS` keys — `stale_date_close`, `pending_expiry`, `day_of_reconfirm`, `safety_checkin`, `reconfirm_timeout`, `deletion_process` — plus the now-orphan `notifyLockParties` helper (only the two removed safety handlers referenced it; grep confirmed zero remaining refs). Kept `chat_purge`, `analytics_relay` (dead but owned by P6/P11 per D-11), and all working handlers: `offer_expiry`, `standby_roll`, `bulk_withdraw`, `rating_window`, `notify`. `index.ts` untouched (0-line diff).

**Task 2 — Deno tests (commit `f3e938b`):**
- `handlers_test.ts`: pruned `ALL_TYPES` to drop the 6 removed types; kept `chat_purge`/`analytics_relay`/`notify` + working types so the "every type has a handler" assertion still passes.
- `handlers_rpc_fail_closed_test.ts`: deleted the 4 `assertRejects` cases for `deletion_process`/`stale_date_close`/`pending_expiry`/`reconfirm_timeout` (their handlers are gone); kept the `chat_purge` and `analytics_relay` reject cases so the fail-closed net stays asserted for the remaining missing-RPC handlers.

## Verification

- **Deno suite green:** `deno test --allow-env handlers_test.ts handlers_rpc_fail_closed_test.ts` → **11 passed, 0 failed** (run with `--no-check`; see Deferred Issues for the type-check note).
- 6 dead handlers + `notifyLockParties` absent from `handlers.ts` (grep PASS).
- `ALL_TYPES` lists 0 of the 6 removed types.
- Exactly 2 reject cases remain (`chat_purge`, `analytics_relay`); 0 dead reject cases.
- `git diff supabase/functions/process-jobs/index.ts` empty — runner fail-closed net intact.
- No `job_type` enum value dropped (no migration in this plan).
- **No live producer enqueues any of the 6 removed types.** `grep -rn "enqueue_job"` across migrations shows live producers only enqueue `offer_expiry`, `standby_roll`, `rating_window`, `bulk_withdraw` (all kept). The only `safety_checkin` reference is in `supabase/tests/p2_jobs_rpcs.sql`, an enqueue-dedup idempotency test that uses the string as an arbitrary type label — not a producer wiring.

## Deviations from Plan

None — plan executed as written. The plan's `<automated>` verify ran `deno test` without `--no-check`; I used `--no-check` to isolate the test result from a pre-existing environment type-resolution gap (see Deferred Issues). Test logic is green either way.

## Deferred Issues

**[Out-of-scope — pre-existing tooling gap] `deno test` default type-check fails on `@types/node`.**
Running `deno test` (with type-checking) on these files errors: "Could not find a matching package for 'npm:@types/node' in the node_modules directory" — the repo has no `nodeModulesDir: auto` deno config, so the transitive `@types/node` reference can't resolve. Confirmed pre-existing and unrelated to this plan: `deno check supabase/functions/process-jobs/index.ts` (untouched file) passes alone, and the error only surfaces when the std-assert test imports trigger the node-types resolver. The test *logic* passes 11/11 under `--no-check`. Not fixed here (pre-existing env/config, outside this plan's deletion-only scope).

## Self-Check: PASSED

- Files modified exist: handlers.ts, handlers_test.ts, handlers_rpc_fail_closed_test.ts — all present.
- Commits exist: `0f929ff` (Task 1), `f3e938b` (Task 2) — both in `git log`.
- SUMMARY created at `.planning/phases/02-loop-closure-host-controls-p0/02-01-SUMMARY.md`.
