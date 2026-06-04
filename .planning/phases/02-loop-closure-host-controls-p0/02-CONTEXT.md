# Phase 2: Loop Closure & Host Controls (P0) - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the core loop terminate and give hosts the controls to run their nights. Delivers audit items **E5** (lock `completed` transition + expiry sweep), **E6** (`cancel_night` RPC + UI), **E7** (`update_night` RPC + edit UI), **E8** (`interest_received` notification to host), **E9** (remove poison-loop risk). Backend-heavy: migrations, SECURITY DEFINER RPCs, cron/job wiring, notification dispatch.

**In scope:** the lock active→completed transition + no-show path; past-dated `seeking` night expiry sweep; host cancel/unpublish + edit RPCs and their minimal UI on `/my-nights` + interested list; the `interest_received` dispatch from `match_ingest_interest`; cleanup of dead job handlers.

**Out of scope (own phases):** ratings→reliability aggregation (E17/Phase 6 — E5 only produces the `completed` state + no-show flag that E17 later consumes); safety flows day_of_reconfirm/safety_checkin reimplementation (E19/Phase 6 — Phase 2 only REMOVES the dead handlers); host reject_candidate (E12/Phase 3); creator controls who-pays/vibe/cover (E11/Phase 3); plan-on-match render (E13/Phase 3).
</domain>

<decisions>
## Implementation Decisions

### E5 — Loop completion model
- **D-01:** Date reaches `completed` via a HYBRID model: a cron job flips `locks.status` active→completed (and `date_instances`→completed) after the night's end time + a grace buffer; EITHER party can flag "didn't happen / no-show" instead (sets the existing `no_show` lock_status enum value, currently unreachable). The loop always terminates; no-shows are captured.
- **D-02:** A past-dated `seeking` night (no match) is auto-swept to a terminal state (completed/expired) by the same/related cron once `starts_at` + grace passes. Terminal; host can repost a new night. (Closes the "stale seeking night lives forever" trap.)
- **D-03:** E5 only PRODUCES the terminal states + no-show signal. Computing `reliability_score` from these is E17/Phase 6 — do NOT build aggregation here (but make the `completed`/`no_show`/rating-window data shape clean for E17 to consume).

### E6/E7 — Host cancel & edit
- **D-04:** `cancel_night` = SOFT unpublish (reversible, reuses/keeps interest data, hides the night from feed eligibility) — NOT a hard delete. Hard delete is reserved/out-of-scope for now. When a night with already-interested candidates is cancelled, dispatch a notification to those candidates that the night was cancelled.
- **D-05:** `update_night` lets the host edit the night (time/venue/duration/ambient per the audit). When a MATERIAL field changes (time or venue) on a night that already has interested candidates, notify those candidates of the change. Non-material edits (e.g. ambient) need no notification.
- **D-06:** Both are SECURITY DEFINER RPCs that re-check `auth.uid()` = the night's creator (secure-by-default; reuse the established definer-RPC + RLS patterns; no `USING(true)`). Run the Supabase security advisor after the DDL.

### E8 — Interest-received notification
- **D-07:** Dispatch `interest_received` from `match_ingest_interest` (the right-swipe ingestion path), deep-linked to that night's `/dates/[slug]/interested` list. The `interest_received` enum is already defined-but-never-dispatched. In-app notification PER interest; throttle email/push to a digest when volume is high so a popular night doesn't spam the host (exact throttle threshold = planner/research discretion).

### E9 — Poison-loop cleanup
- **D-08:** REMOVE the dead job handlers and any enqueue paths now (`reconfirm_timeout`, `stale_date_close`, `expire_pending`/`pending_expiry`, `process_deletion`, and the `day_of_reconfirm`/`safety_checkin` handlers that have no producers/RPCs). The fail-closed test already prevents queue crashes; this removes dead branches that read as real. Safety flows (day_of_reconfirm/safety_checkin) are rebuilt properly in E19/Phase 6. Sequence E9 cleanup BEFORE E5 schedules any new cron jobs (per the audit dep note).

### Claude's Discretion
- Exact grace-buffer durations (completion + expiry sweep); cron schedule/cadence (reuse the existing Vercel Cron + process-jobs pattern).
- Throttle threshold/digest window for E8 email/push.
- Whether the no-show flag is a new RPC or folded into an existing transition.
- Minimal UI affordances for cancel/edit on `/my-nights` + interested list (follow DESIGN-SYSTEM.md; small surfaces).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope source
- `docs/superpowers/reports/2026-06-03-MVP-AUDIT.md` §E (E5–E9), §B (Critical #3 lock-never-completed #5 no-host-notif, High #11 #12 #14 #19 #20), §D (#14 #15 #16) — authoritative requirements.
- `.planning/REQUIREMENTS.md` — REQ-E5..REQ-E9.
- `.planning/intel/constraints.md` (RPC signatures, blind contract, secure-by-default RLS, gated prod-apply protocol).

### Existing backend surfaces to read
- `supabase/migrations/20260525120700_p0_locks.sql` (lock_status enum: active/completed/cancelled/no_show), `20260525120300_p0_date_instances.sql` (date_match_status enum), `20260527127200_p5_job_rpcs_backfill.sql` (close_rating_window — only stamps rating_closed_at; no completed transition).
- `supabase/migrations/20260527126200_p5_shortlist.sql` (`match_ingest_interest` — E8 dispatch site), `20260527126700_p5_s5_swipe_hook.sql` (record_swipe → match_ingest_interest).
- `supabase/functions/process-jobs/index.ts` + `handlers.ts` + `handlers_test.ts` + `handlers_rpc_fail_closed_test.ts` (E9 dead handlers + the existing fail-closed safety).
- `notif-map.ts` (notification type → nav mapping; `interest_received` defined here), `dispatch_notification` RPC pattern.
- `apps/web/app/my-nights/page.tsx` + `apps/web/app/dates/[slug]/interested/` (E6/E7 minimal host UI surfaces).
- `apps/web/vercel.json` (Vercel Cron definitions for the sweep jobs).

### Constraints / patterns (MANDATORY)
- Secure-by-default RLS + SECURITY DEFINER re-checking `auth.uid()`; run `mcp__supabase__get_advisors` (security) after every DDL; review live migrations before prod apply; gated prod-apply (local-green first). `docs/superpowers/DESIGN-SYSTEM.md` for any UI.
- `.planning/codebase/ARCHITECTURE.md` (Definer-RPC + idempotency-ledger + edge-functions-for-side-effects patterns), `CONVENTIONS.md` (RLS conventions).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lock_status` already has `completed` + `no_show` enum values (just no transition reaches them) — E5 wires the transition, no enum migration needed for those.
- `close_rating_window` (job RPC) — E5's completion should coordinate with the existing rating-window stamping.
- `match_ingest_interest` + `dispatch_notification` + `notif-map.ts` `interest_received` entry — E8 is a dispatch-site addition, not new plumbing.
- The process-jobs cron + `handlers_rpc_fail_closed_test.ts` — the fail-closed safety net already exists; E9 removes dead code on top of it.
- Existing SECURITY DEFINER + idempotency-ledger (`transition_idempotency`) patterns for E6/E7 RPCs.

### Established Patterns
- Definer RPCs re-check `auth.uid()`, validate the actor, emit notifications to counterparts; cron jobs run via Vercel Cron → process-jobs edge; all writes atomic/idempotent.

### Integration Points
- New migrations (E5 completion+sweep RPC/cron, E6 cancel_night, E7 update_night) + E8 dispatch edit to match_ingest_interest + E9 handler removals. Minimal host UI on /my-nights + interested list. Notification dispatch to candidates on cancel/material-edit.
</code_context>

<specifics>
## Specific Ideas
- The vision anchor: "the loop never traps the user AND always terminates." E5 is the lifecycle terminus that unblocks the entire trust loop (E17). Make `completed`/`no_show` clean for Phase 6 to consume.
- Respect people who swiped in: cancel/material-edit notifies interested candidates (D-04/D-05).
</specifics>

<deferred>
## Deferred Ideas
- `reliability_score` aggregation from completed/no_show/ratings → E17/Phase 6.
- Rebuilding day_of_reconfirm + safety_checkin safety flows → E19/Phase 6 (Phase 2 only removes the dead handlers).
- `reject_candidate` (host decline) → E12/Phase 3.
- Hard delete of a night → out of scope (soft cancel only for now).

### Reviewed Todos (not folded)
None — no matching pending todos.
</deferred>

---

*Phase: 2-Loop Closure & Host Controls (P0)*
*Context gathered: 2026-06-03*
