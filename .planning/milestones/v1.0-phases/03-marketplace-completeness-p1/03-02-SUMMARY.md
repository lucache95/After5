---
phase: 03-marketplace-completeness-p1
plan: 02
subsystem: host-triage-backend
tags: [rpc, definer, silent-decline, edge-function, security, queue]
requires:
  - "queue_status.passed_by_host enum value (03-01)"
  - "match_instance_lock_key advisory-lock helper (p5)"
provides:
  - "reject_candidate(p_actor,p_instance,p_candidate) DEFINER RPC — creator-only, silent, idempotent"
  - "match-reject-candidate edge function (withMatchHandler envelope)"
  - "rejectCandidate(instance,candidate) client wrapper in match.ts"
  - "cannot_reject_active_offer error name + dry copy in match.ts MESSAGES"
affects:
  - "03-07 InterestedList decline UI (consumes rejectCandidate)"
  - "REQ-E12 backend half complete; UI half (decline/withdraw/outcome) still pending"
tech-stack:
  added: []
  patterns: [definer-rpc-skeleton, advisory-lock-serialize, anon-revoke-on-new-rpc, silent-mutation, idempotent-noop]
key-files:
  created:
    - supabase/migrations/20260605120300_e12_reject_candidate.sql
    - supabase/functions/match-reject-candidate/index.ts
    - supabase/tests/e12_reject_candidate.sql
  modified:
    - apps/web/lib/after5/match.ts
    - packages/types/src/database.ts
decisions:
  - "Idempotency via get diagnostics row_count + already-passed_by_host probe (no idem-ledger needed for a void RPC)"
  - "SILENT (D-04): zero dispatch_notification calls; analytics_events('candidate_rejected') is the only side-record"
  - "cannot_reject_active_offer (P0001) guards the offer-holder per D-09 — withdraw the offer first"
  - "Anon EXECUTE explicitly revoked (Supabase auto-grant); test asserts via has_function_privilege"
metrics:
  duration: ~15m
  completed: 2026-06-03
---

# Phase 3 Plan 02: reject_candidate DEFINER RPC (silent host decline) Summary

The one genuinely-new RPC of Phase 3: `reject_candidate`, a creator-only DEFINER function that moves a candidate's `queue_entry` to `passed_by_host` and tells the candidate nothing (D-04). Plus the thin edge envelope and the `rejectCandidate` client wrapper the later InterestedList decline UI consumes.

## What was built

- **`reject_candidate(p_actor, p_instance, p_candidate) returns void`** — `security definer`, `set search_path=public`. Pipeline copied from the `match_make_offer` exemplar but stripped to: auth recheck (`P5001`) → feature flag (`P5000`) → advisory-lock (`match_instance_lock_key`) → creator-ownership recheck (`P0002` no-instance / `42501` non-creator) → `cannot_reject_active_offer` guard (`P0001`, D-09) → `update queue_entries ... passed_by_host` over `(interested,shortlisted,standby)` → `analytics_events('candidate_rejected')`. No idempotency ledger, no reciprocal, no chat, no expiry job, and **no `dispatch_notification` anywhere**.
- **Idempotent:** a second reject on an already-`passed_by_host` row updates zero rows but returns success (probe before raising `not_rejectable`).
- **Grant posture:** `revoke execute ... from public; from anon; grant ... to authenticated` (Pitfall 2 — Supabase auto-grants anon on new public functions).
- **`match-reject-candidate` edge fn** mirrors `match-shortlist` (`withMatchHandler` + `callRpcAndRespond(client, 'reject_candidate', {p_actor,p_instance,p_candidate})`), 400 on missing `{instance,candidate}`.
- **`rejectCandidate(instance, candidate)` wrapper** in `match.ts` + `cannot_reject_active_offer → 'pull the offer first.'` in MESSAGES + the error-name union.

## Verification

LOCAL chain GREEN (I owned the reset this wave; 03-03 is UI-only):
- `pnpm db:reset` — all migrations applied incl. `20260605120300_e12_reject_candidate.sql`
- `pnpm db:types` — regenerated; `reject_candidate` signature added to `database.ts`
- `pnpm db:test` — full SQL suite exit 0. `e12_reject_candidate.sql` 6 assertions: happy path + `passed_by_host` + SILENT (zero notifications) + idempotent; `42501` non-creator; `P5001` actor!=jwt; `P0001` active-offer-holder; anon EXECUTE revoked.
- `pnpm -w typecheck` — 6/6 packages pass.

Security shape confirmed: `security definer` + `set search_path` + explicit `revoke from anon` + NO `using(true)` (it's a function, not a policy) + NO `dispatch_notification`.

**PROD APPLY GATED** — no `db:push`, no prod migration, no edge deploy to prod. Local 127.0.0.1 only. Security advisor intentionally NOT run (orchestrator batches it).

## Deviations from Plan

None — plan executed as written. The idempotency approach (`get diagnostics row_count` + already-passed probe) is the concrete realization of the plan's "adjust the `not found` guard so a second call does not raise" instruction.

## Requirement progress

**REQ-E12 (backend half COMPLETE):** `reject_candidate` RPC + edge fn + client wrapper shipped and locally green. The UI half — InterestedList decline action, offer-outcome pills, withdraw control (D-05) — remains pending (03-07). REQ-E12 is therefore NOT yet fully satisfied; do not mark complete until the UI lands.

## Known Stubs

None.

## Self-Check: PASSED

- Files: migration, edge fn, test, match.ts, SUMMARY all FOUND.
- Commits: 550d8ca, c6a3fc1, 99dbd64 all FOUND in git log.
