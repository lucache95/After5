---
phase: 07-enhancements-and-polish-p3
plan: 03
subsystem: dating-match
tags: [rpc, security-definer, queue, withdraw, rls, e24]
requires:
  - queue_entries (status enum incl. interested/shortlisted/standby; candidate-read RLS)
  - match_withdraw auth-gate pattern (P5001)
provides:
  - withdraw_interest(p_instance uuid, p_actor uuid default auth.uid()) DEFINER RPC
  - candidate plain-interest withdraw path (pre-offer, silent)
affects:
  - supabase/migrations
  - supabase/tests
tech-stack:
  added: []
  patterns:
    - secure-by-default DEFINER RPC (search_path pinned, revoke public/anon, grant authenticated)
    - status-scoped delete (status='interested' only)
key-files:
  created:
    - supabase/migrations/20260606140200_e24_withdraw_interest.sql
    - supabase/tests/e24_withdraw_interest.sql
  modified: []
decisions:
  - "withdraw_interest deletes interest only; swipe row left intact (re-swipe allowed, D-24 simplest)"
  - "no v2 gate / advisory lock / offer resolution / notification — pre-offer plain-interest withdraw is silent"
  - "REQ-E24 NOT marked complete: backend half only; candidate standby view + withdraw UI land downstream"
metrics:
  duration_min: 12
  completed: 2026-06-05
  tasks: 2
  files: 2
---

# Phase 07 Plan 03: withdraw_interest (E24 plain-interest withdraw) Summary

A candidate can withdraw a pending `interested` queue interest via a new secure-by-default DEFINER RPC `withdraw_interest(p_instance, p_actor=auth.uid())` that deletes only the caller's own `interested` row and cannot touch another user's row or a non-interested (shortlisted/offer/locked/standby) row.

## What Was Built

- **`withdraw_interest` RPC** (`20260606140200_e24_withdraw_interest.sql`) — a lighter sibling of `match_withdraw`. Copies the `p_actor is distinct from auth.uid()` → `P5001 auth_mismatch` gate and drops everything else: no `match_v2_enabled` feature gate, no advisory lock, no offer resolution, no notification. Body is a single status-scoped delete: `delete from queue_entries where date_instance_id = p_instance and candidate_id = p_actor and status = 'interested'`. `security definer set search_path = public`; tail `revoke execute … from public, anon` + `grant execute … to authenticated`. Param order is the locked correction (required `p_instance` before defaulted `p_actor`). Implements REQ-E24's backend half.
- **`e24_withdraw_interest.sql` test** — 5 assertions over the project's `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated` harness: (1) owner-delete-only, (1b) default `p_actor=auth.uid()`, (2) non-owner → P5001 + no-delete, (3) status-scope (a shortlisted row survives), (4) candidate-read RLS deny-non-owner.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 2 (RED) | e24 failing assertions | d975970 | supabase/tests/e24_withdraw_interest.sql |
| 1 (GREEN) | withdraw_interest DEFINER RPC | 0457adc | supabase/migrations/20260606140200_e24_withdraw_interest.sql |

(TDD order: the test was authored and committed RED first, then the migration made it GREEN.)

## TDD Gate Compliance

- RED: `test(07-03)` commit `d975970` — test failed with `function withdraw_interest(uuid, uuid) does not exist` before the migration.
- GREEN: `feat(07-03)` commit `0457adc` — all 5 assertions pass; `psql -f … e24_withdraw_interest.sql` exits 0.
- REFACTOR: none needed (single-statement DELETE; nothing to clean up).

## Verification

- `psql … -f supabase/tests/e24_withdraw_interest.sql` exits 0; NOTICES: E24(1)/(1b)/(2)/(3)/(4) all OK.
- Migration `20260606140200` sorts after the latest on disk (`20260606140100`), unique version prefix (Phase-6 ordering lesson).
- Threat register: T-07-07 (EoP) mitigated by the P5001 gate + `candidate_id = p_actor` predicate; T-07-08 (wrong-status delete) by `status = 'interested'`; T-07-09 (search_path injection) by `set search_path = public`, no `USING(true)`; T-07-10 (cross-user read) by the existing `queue_candidate_read_own` RLS, asserted in test (4).

## Gated Prod-Apply

GATED — prod `ufufmcpnysvwtutpbian` UNTOUCHED. The `withdraw_interest` migration is local-green only. The `e24_withdraw_interest.sql` assertion run + Supabase security advisor + batched prod-apply are owned by the 07-09 phase-close gate (mirrors 07-01/07-02).

## Deviations from Plan

None — plan executed exactly as written. The migration applied cleanly via direct `psql -f` (the existing chain through `20260606140100` was already applied locally; no `db reset` was required for a green test run).

## Self-Check: PASSED

- FOUND: supabase/migrations/20260606140200_e24_withdraw_interest.sql
- FOUND: supabase/tests/e24_withdraw_interest.sql
- FOUND commit: d975970 (test, RED)
- FOUND commit: 0457adc (feat, GREEN)
