---
phase: 06-trust-and-safety-p2
plan: 03
subsystem: database
tags: [postgres, plpgsql, definer-rpc, process-jobs, edge-function, notifications, react, vaul, sonner, supabase]

# Dependency graph
requires:
  - phase: 02-notifications-jobs
    provides: dispatch_notification (safety types bypass consent/quiet/rate), notifications table + job runner (process-jobs handlers, callRpc)
  - phase: 05-progressive-reveal
    provides: LockDetail reveal surface + loader (matches/[lockId]) the soft cards extend
provides:
  - dispatch_date_reconfirm(uuid) + dispatch_safety_checkin(uuid) stale-tolerant DEFINER dispatch RPCs (notify both parties, never mutate lock state)
  - day_of_reconfirm + safety_checkin entries in the process-jobs HANDLERS table
  - soft "still on?" reconfirm + "all good?" check-in cards on LockDetail (+ loader flags), no red, no auto-cancel
  - e19_safety_handlers.sql safety-critical assertions (dispatch / poison-loop / no-auto-cancel)
affects: [06-04, 06-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stale-tolerant never-raise dispatch RPC (mirrors close_rating_window): null/missing/non-active lock returns void to drain the job, never raises (callRpc throws -> dead-letter@5)"
    - "Soft notify-only safety posture (D-03/D-04): dispatch RPCs ONLY call dispatch_notification — no lock-state mutation, no auto-cancel, no escalation"
    - "Loader-flag-gated inline LockDetail card (mirrors ratingOpen): page.tsx derives reconfirmDue/reconfirmNoReply/checkinDue from the viewer's own RLS-scoped notification rows"

key-files:
  created:
    - supabase/migrations/20260605120100_e19_safety_dispatch_rpcs.sql
    - supabase/tests/e19_safety_handlers.sql
  modified:
    - supabase/functions/process-jobs/handlers.ts
    - apps/web/app/matches/[lockId]/LockDetail.tsx
    - apps/web/app/matches/[lockId]/page.tsx

key-decisions:
  - "Dispatch RPCs are notify-only — no update locks set status, no auto-cancel, no escalation (D-03/D-04 soft posture is the central safety invariant)"
  - "Both RPCs never-raise on null/missing/non-active lock (poison-loop avoidance: handlers.ts callRpc throws on RPC error -> backoff -> dead-letter@5)"
  - "Loader flags derived from the viewer's own unread date_reconfirm/safety_checkin notification rows (RLS notifications_recipient_read auto-scopes to auth.uid()); reconfirmNoReply = unread 4h+ (soft nudge, no escalation)"
  - "gotta bail reuses the EXISTING cancel flow (same vaul Drawer + CancelWithReasonPicker); something's wrong opens a vaul confirm that is the sole safety_alert affordance and the only accent-carrying commit"
  - "No new red/destructive token; blush soft-warning wash (bg-[#FFB3D1]/25); acks/flag are optimistic local dismissals + sonner toasts (no lock mutation)"

patterns-established:
  - "E19 consumer half: job_type -> dispatch RPC -> dispatch_notification(both parties); producers (enqueues) are 06-04"
  - "Soft safety surface: warm card chrome (rounded-3xl bg-shell-ink/[0.05] p-4), no red, no takeover, gated by loader booleans"

requirements-completed: [REQ-E19]

# Metrics
duration: 18min
completed: 2026-06-05
---

# Phase 6 Plan 03: E19 Safety Consumers Summary

**Two stale-tolerant DEFINER dispatch RPCs (date_reconfirm + safety_checkin) wired into the process-jobs HANDLERS table, plus warm "still on?" / "all good?" soft cards on LockDetail — notify-only, never auto-cancelling, never poison-looping.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-05T05:42:00Z
- **Completed:** 2026-06-05T06:00:00Z
- **Tasks:** 4
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `dispatch_date_reconfirm(uuid)` + `dispatch_safety_checkin(uuid)`: DEFINER RPCs that notify BOTH parties and drain cleanly on any null/missing/non-active lock (never raise), pinning `set search_path=public` + `revoke all from public, anon, authenticated`, with zero lock-state mutation (D-03/D-04 soft posture)
- `day_of_reconfirm` + `safety_checkin` handlers added to the process-jobs HANDLERS table, mirroring the `rating_window` entry exactly (callRpc -> dispatch RPC)
- Soft `still on?` reconfirm + `all good?` check-in cards on LockDetail, gated by three new loader flags; "gotta bail" reuses the existing cancel flow, "something's wrong" opens a vaul confirm (the only `safety_alert` affordance), acks/flag fire sonner toasts; no red, no auto-cancel
- `supabase/tests/e19_safety_handlers.sql` with all four safety-critical assertions: (a)/(b) dispatch to both parties, (c) cancelled/missing/null lock drains cleanly with no new rows, (d) a no-ack reconfirm leaves `locks.status` unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: dispatch_date_reconfirm + dispatch_safety_checkin RPCs (migration)** - `7f138f0` (feat)
2. **Task 2: day_of_reconfirm + safety_checkin handlers** - `8433a72` (feat)
3. **Task 3: soft reconfirm + check-in cards on LockDetail + loader flags** - `d6af38e` (feat)
4. **Task 4: e19 safety-handler SQL assertions** - `102af18` (test)

**Plan metadata:** _(this docs commit)_

## Files Created/Modified
- `supabase/migrations/20260605120100_e19_safety_dispatch_rpcs.sql` - two stale-tolerant DEFINER dispatch RPCs (notify both parties, never mutate lock state)
- `supabase/functions/process-jobs/handlers.ts` - two HANDLERS entries routing the safety job types to their dispatch RPCs
- `apps/web/app/matches/[lockId]/LockDetail.tsx` - three loader-gated soft cards (reconfirm/no-reply/check-in) + vaul flag confirm + sonner ack toasts
- `apps/web/app/matches/[lockId]/page.tsx` - derives reconfirmDue/reconfirmNoReply/checkinDue from the viewer's RLS-scoped notification rows
- `supabase/tests/e19_safety_handlers.sql` - four safety-critical SQL assertions (dispatch / poison-loop / no-auto-cancel)

## Decisions Made
- Notify-only dispatch RPCs (no lock-state mutation) — the central D-03/D-04 safety invariant. A no-ack reconfirm leaves the lock untouched.
- Never-raise on any non-active/missing/null lock so the cron job drains instead of poison-looping (callRpc throws -> dead-letter@5).
- Loader flags derived from the viewer's own unread notification rows (RLS-scoped), keeping the derivation light and mirroring `isRatingOpen`; `reconfirmNoReply` is an unread-4h+ soft nudge, never an escalation.
- "gotta bail" reuses the existing cancel flow; "something's wrong" is the sole `safety_alert` affordance and the only accent-carrying commit. No new red/destructive token.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. (The shell profile's errexit aborted a couple of compound `&&` grep-gate chains at the trailing `echo OK`; each gate was re-run individually and confirmed passing — the underlying assertions all held. tsc clean on the web app.)

## Known Stubs
The ack/flag handlers (`ackReconfirm`/`ackCheckin`/`confirmFlag`) are optimistic local dismissals + toasts; they do NOT yet POST a server-side ack or dispatch the `safety_alert` over the wire. This is intentional and on-spec for this plan: the surfaces are notify-driven and read-mostly (UI-SPEC §E19 / Copywriting "if an in-app ack POST fails…"), and the cards correctly clear on dismiss. Server-side ack persistence + the real `safety_alert` dispatch wiring are downstream (producers/wiring continue in 06-04, runtime verification in 06-05). No stub blocks the plan goal (the consumer dispatch path is fully built).

## GATED — deferred to 06-05
- Migration `20260605120100_e19_safety_dispatch_rpcs.sql` is authored but NOT applied (local apply + security advisor + the `e19_safety_handlers.sql` run all deferred to 06-05). Prod (`ufufmcpnysvwtutpbian`) untouched. Never `supabase db push`.
- process-jobs edge-function redeploy gated to 06-05.
- Visual-verify @420px of the soft cards gated to 06-05.

## Next Phase Readiness
- 06-04 (producer half) can build on these RPCs + handlers existing: it re-creates `match_accept_offer` / `match_resolve_reciprocal` (via CREATE OR REPLACE) to enqueue `day_of_reconfirm` + `safety_checkin` jobs beside the existing `rating_window` enqueue.
- 06-05 owns the gated local apply + advisor + SQL assertion run + visual-verify.

## Self-Check: PASSED

All 5 artifact files exist; all 4 task commits (7f138f0, 8433a72, d6af38e, 102af18) found in git history.

---
*Phase: 06-trust-and-safety-p2*
*Completed: 2026-06-05*
