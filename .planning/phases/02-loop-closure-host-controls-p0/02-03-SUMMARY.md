---
phase: 02-loop-closure-host-controls-p0
plan: 03
subsystem: database

tags: [postgres, security-definer, supabase, vercel-cron, rpc, idempotency, jobs-queue, loop-terminus]

# Dependency graph
requires:
  - phase: 02-01
    provides: E9 dead-handler cleanup (queue safe before a new cron schedules)
  - phase: 02-02
    provides: additive 'expired' date_match_status enum value (the seeking-sweep terminus)
provides:
  - "sweep_loop_terminus(): service-role batch sweep — past-dated active locks -> completed (both tables) + rating_window job enqueued; past-dated unmatched seeking nights -> expired"
  - "flag_no_show(p_actor,p_lock,p_idem_key): membership-auth DEFINER reaching the previously-unreachable locks.status='no_show' (lock-level only)"
  - "/api/cron/close-loop Vercel cron route (CRON_SECRET-gated) invoking the sweep on a */15 schedule"
  - "Cron-completed locks coordinate the rating window via enqueue_job('rating_window',...) so E17 has data to aggregate"
affects: [E17, phase-6, reliability-score, host-controls, my-nights]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Service-role batch sweep mirroring close_rating_window: idempotent, stale-tolerant, never-raises (a raise re-poisons the cron loop)"
    - "Cron route invokes a service-role sweep RPC directly (no new job_type enum) — Pattern 4 dedicated-cron approach"
    - "Two-status-model discipline: no_show is lock-level only; date_instances terminal states are completed/expired (Pitfall 1)"
    - "Membership auth predicate (auth.uid() in creator/matched) — distinct from the creator-only E6/E7 RPCs (Pitfall 5)"

key-files:
  created:
    - supabase/migrations/20260604121000_e5_loop_completion.sql
    - supabase/tests/e5_loop_completion.sql
    - apps/web/app/api/cron/close-loop/route.ts
    - apps/web/app/api/cron/close-loop/route.test.ts
  modified:
    - apps/web/vercel.json
    - packages/types/src/database.ts
    - supabase/tests/p2_notifications.sql

key-decisions:
  - "Rating-window coordination: sweep_loop_terminus ENQUEUES rating_window per newly-completed lock (close_rating_window does NOT self-discover; accept_lock enqueues it). Same anchor (upper(time_range)+2h) + dedup key (rating:<lock>) as accept_lock."
  - "COMPLETION_GRACE = 3h after upper(time_range); rating_window run_after stays upper(time_range)+2h so cron- and accept-path completions open the window at the same wall-clock anchor."
  - "Seeking-sweep terminus is 'expired' (D-10), NOT 'completed' — a never-matched night is distinct from a date that ran."
  - "flag_no_show is a NEW DEFINER RPC with membership auth (either party); sets locks.status='no_show' only, never date_instances.status."
  - "Cron cadence */15 (Claude discretion, D-01)."

patterns-established:
  - "never-raise batch sweep: whole-body EXCEPTION WHEN others -> return n, so a partial sweep cannot poison the cron"
  - "cron route reuses CRON_SECRET (no new env var); ?dry_run authorizes without invoking the RPC"

requirements-completed: [REQ-E5]

# Metrics
duration: 7min
completed: 2026-06-04
---

# Phase 2 Plan 03: E5 Loop Terminus Summary

**sweep_loop_terminus() + flag_no_show() RPCs and a CRON_SECRET-gated /api/cron/close-loop route that flip past-dated active locks to completed (enqueuing the rating window), expire past-dated unmatched seeking nights, and let either lock party reach the previously-unreachable no_show — so the loop always terminates and never traps the user.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-04T01:43:10Z
- **Completed:** 2026-06-04T01:50:00Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `sweep_loop_terminus()` service-role RPC: (a) past-dated active locks -> `completed` and their matched `date_instances` -> `completed`, enqueuing a `rating_window` job per newly-completed lock; (b) past-dated unmatched `seeking` nights -> `expired`. Idempotent, stale-tolerant, never raises.
- `flag_no_show()` DEFINER RPC with membership auth (either creator or matched_user) reaching `locks.status='no_show'` for the first time, lock-level only.
- `/api/cron/close-loop` Vercel cron route (CRON_SECRET Bearer or `?secret=`, 500 if unset, 401 on mismatch, `?dry_run` skip) invoking the sweep via the admin client; `vercel.json` entry at `*/15`.
- Resolved the REQUIRED rating-window coordination: cron-completed locks now reach a rating window (E17 has data to aggregate).

## Task Commits

Each task was committed atomically:

1. **Task 1: E5 migration (sweep_loop_terminus + flag_no_show) + psql test** - `21bea2c` (feat) — includes a `[Rule 1]` fix to a stale sibling test (see Deviations).
2. **Task 2: close-loop cron route + test + vercel.json entry** - `b571493` (feat)
3. **Task 3: regenerate database types + typecheck** - `38a7811` (chore)

_Task 1 combined the TDD migration + test in one commit (the psql assertion test and the RPC it exercises are a single faithful unit; the test failed meaningfully against the empty schema before the RPCs existed)._

## Files Created/Modified
- `supabase/migrations/20260604121000_e5_loop_completion.sql` — the two RPCs + grants (service-role REVOKE ALL for the sweep; revoke public/anon + grant authenticated for flag_no_show).
- `supabase/tests/e5_loop_completion.sql` — psql assertions: completion + rating_window enqueue, expired-sweep (distinct from completed), idempotency (no duplicate job), no_show by member, reject non-member (42501), future-untouched.
- `apps/web/app/api/cron/close-loop/route.ts` — CRON_SECRET-gated GET invoking `admin.rpc('sweep_loop_terminus')`.
- `apps/web/app/api/cron/close-loop/route.test.ts` — 7 tests (auth gates, sweep invocation, dry-run, rpc-error -> 500).
- `apps/web/vercel.json` — `/api/cron/close-loop` cron at `*/15 * * * *`.
- `packages/types/src/database.ts` — regenerated; adds `flag_no_show` + `sweep_loop_terminus` to `Functions`.
- `supabase/tests/p2_notifications.sql` — [Rule 1] stale enum-count guard fixed (see Deviations).

## Decisions Made

**Rating-window coordination (REQUIRED — resolved with evidence):**
- **Read `match_accept_offer` (20260527126400, step 16, lines 127-130):** it ENQUEUES `enqueue_job('rating_window', upper(rng)+'2 hours', {lock_id, instance}, 'rating:'||lid)`. The accept path does NOT rely on self-discovery.
- **Read `close_rating_window` body (20260527127200, lines 79-94):** it takes an EXPLICIT `p_lock` and only stamps the handed-in lock; it does NOT scan for completed-but-unstamped locks.
- **Read the `rating_window` job handler (process-jobs/handlers.ts line 64):** it calls `close_rating_window(p_lock = payload.lock_id)`.
- **Conclusion:** a cron-completed lock that did NOT enqueue would NEVER reach a rating window, leaving E17 nothing to aggregate. Therefore `sweep_loop_terminus` WIRES `enqueue_job('rating_window', upper(time_range)+2h, {lock_id, instance}, 'rating:'||lock_id)` for each newly-completed lock — same anchor and dedup key as accept_lock, so cron- and accept-path completions are coherent and a duplicate sweep collapses to one job (verified by the idempotency test asserting exactly one rating_window row).

Other decisions: COMPLETION_GRACE = 3h (D-01 discretion); seeking-sweep terminus = `expired` not `completed` (D-10); flag_no_show = new membership-auth RPC (D-01/Pitfall 5); cron cadence `*/15` (D-01 discretion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale notification_type enum-count guard in p2_notifications.sql**
- **Found during:** Task 1 (running the full `pnpm db:test` suite after applying the E5 migration)
- **Issue:** `supabase/tests/p2_notifications.sql` asserted `array_length(enum_range(null::notification_type),1) <> 20` (a hardcoded magic-number guard). The `notification_type` enum already had 24 values: the gated-inbox migration (`20260603120000`, on main/prod) added `interest_received`/`identity_revealed`, and Phase-02 wave-1 (`20260604120000`, plan 02-02 — a dependency of this plan) added `night_cancelled`/`night_changed`. The guard was already broken before this plan ran; plans 02-01/02-02 ran only their per-task tests, not the full suite, so it had not surfaced. The wave-merge `db:test` gate requires the whole suite green.
- **Fix:** Updated the count to 24 and added explicit existence assertions for the four additive values (`interest_received`, `identity_revealed`, `night_cancelled`, `night_changed`) so the guard stays meaningful rather than a brittle magic number.
- **Files modified:** `supabase/tests/p2_notifications.sql`
- **Verification:** `psql ... -f supabase/tests/p2_notifications.sql` passes; full `pnpm db:test` suite exits 0.
- **Committed in:** `21bea2c` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — stale test guard invalidated by dependency enum migrations).
**Impact on plan:** Necessary to keep the wave-merge SQL suite green. No scope creep — a one-line count fix plus four existence checks, no schema change.

## Issues Encountered
- None beyond the deviation above. The migration applied on the first `db:reset`; the E5 test, route test, and typecheck all passed first run.

## Security Advisor

NOT run by this executor — per the orchestrator's spawn instruction, `mcp__supabase__get_advisors type=security` is batched after Wave 2. Grant posture is in place for the advisor to confirm: `sweep_loop_terminus` is `revoke all ... from public, anon, authenticated` (service-role/cron only, no caller input); `flag_no_show` is `revoke ... from public, anon; grant ... to authenticated` (auth enforced inside via `auth.uid()` re-check + membership predicate). Both set `search_path=public`.

## User Setup Required
None — `/api/cron/close-loop` reuses the existing `CRON_SECRET`; no new env vars. The cron deploys with the app on the separate gated deploy step.

## Scope Confirmations
- **No `no_show` ever written to `date_instances`** (Pitfall 1 respected): the only `status='no_show'` write is `update locks set status='no_show'`. `date_instances` is set only to `completed` (completion path) or `expired` (expiry path).
- **PROD APPLY OUT OF SCOPE:** no `db:push`, no prod touch — all work is LOCAL (127.0.0.1) only. New migration timestamp `20260604121000` is AFTER the Wave-1 `20260604120000` enum migration.

## Next Phase Readiness
- The loop now terminates: active locks complete, seeking nights expire, and no-shows are capturable by either party — the `completed`/`no_show`/rating-window data shape is clean for E17/Phase 6 to aggregate `reliability_score` (D-03).
- Remaining in this wave (sequential, run after this plan): 02-04 / 02-05. The DB is left in a clean local-applied state with regenerated types committed.
- Gated for the orchestrator: end-of-wave security advisor run; batched prod apply.

## Self-Check: PASSED

All created files exist on disk; all three task commits (`21bea2c`, `b571493`, `38a7811`) are present in git history.

---
*Phase: 02-loop-closure-host-controls-p0*
*Completed: 2026-06-04*
