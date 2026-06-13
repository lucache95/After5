---
phase: 13
slug: lifecycle-correctness
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-13
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pgTAP (DB, via `pnpm db:test`) + Vitest 2.1.x (packages/* Node + apps/web jsdom via vitest.workspace.ts) + Deno test (edge handlers) |
| **Config file** | `vitest.config.ts` / `vitest.workspace.ts`; pgTAP = loose `.sql` files looped by `pnpm db:test` / `_all_5b.sh` |
| **Quick run command** | `pnpm vitest run <path>` · `deno test <file>` · `psql -f <one>.sql` (single pgTAP) |
| **Full suite command** | `supabase/tests/_all_5b.sh` (db reset → pgTAP → Deno → Vitest → E2E) |
| **Estimated runtime** | Vitest targeted ~5–15s; `pnpm db:test` ~30–60s; full `_all_5b.sh` ~3–6 min |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted command (`pnpm vitest run <path>` / `deno test <file>` / single pgTAP file)
- **After every plan wave:** Run `pnpm vitest run` + `pnpm db:test` (Wave 1) ; full `_all_5b.sh` at the Wave 2 gate
- **Before `/gsd:verify-work`:** Full `_all_5b.sh` must be green (under plan 13-05, after the local migration apply)
- **Max feedback latency:** ~60s for the targeted per-task command

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01 T1 | 01 | 1 | LIFE-04 | T-13-01/02 | kind-branch routes only to known consumer RPCs | Deno | `deno test ... handlers_test.ts > /tmp/13-01-red.log 2>&1; grep -q autoclose_creator_conflicts && grep -q autowithdraw_user_conflicts && grep -qE 'FAILED' /tmp/13-01-red.log` (asserts a genuine RED, not an infra error) | ✅ extend | ⬜ pending |
| 13-01 T2 | 01 | 1 | LIFE-04 | T-13-01 | handler reads producer-keyed payload, not instance_id | Deno | `deno test --allow-none supabase/functions/process-jobs/handlers_test.ts` | ✅ | ⬜ pending |
| 13-01 T3 | 01 | 1 | LIFE-04 | T-13-03 | read-only prod verification (no mutation) | Manual | MCP read-only queries (see RESEARCH prod-verification) | n/a | ⬜ pending |
| 13-02 T1 | 02 | 1 | LIFE-03 | T-13-05/06 | bump dispatch targets the specific candidate; minimal payload | grep gate (DDL) | `grep -v '^--' supabase/migrations/20260613140000_life03_standby_notify.sql \| grep -c standby_bumped` | ❌ new | ⬜ pending |
| 13-02 T2 | 02 | 1 | LIFE-03 | T-13-04 | broadened filter keeps blind-safe projection + ownership scope | grep gate | `grep -c "\.in('status'" apps/web/app/inbox/StandbyList.tsx apps/web/app/inbox/queue/page.tsx` | ✅ edit | ⬜ pending |
| 13-02 T3 | 02 | 1 | LIFE-03 | T-13-04 | standby badge renders by status | Vitest | `pnpm vitest run apps/web/app/inbox/__tests__/StandbyList.test.tsx` | ✅ extend | ⬜ pending |
| 13-02 T4 | 02 | 1 | LIFE-03 | T-13-05 | bump dispatches standby_bumped; queue flips to standby | pgTAP | `test -f supabase/tests/life03_standby_notify.sql && grep -c standby_bumped supabase/tests/life03_standby_notify.sql` (asserts at 13-05 gate) | ❌ new | ⬜ pending |
| 13-02 T5 | 02 | 1 | LIFE-03 | T-13-05 | roll-to-you also notifies (standby_promoted); guard against silent removal | grep gate + pgTAP | `grep -c standby_promoted supabase/migrations/20260527126900_p5_b_complete.sql && grep -c standby_promoted supabase/tests/life03_standby_notify.sql` (pgTAP asserts at 13-05 gate) | ⚠️ existing + new assert | ⬜ pending |
| 13-03 T1 | 03 | 1 | LIFE-02 | T-13-07/09/10 | file_report party-checked, taxonomy reused, RLS deny | pgTAP | `grep -v '^--' supabase/migrations/20260613141000_life02_file_report.sql \| grep -c "file_report\|report_reason_category"` (asserts at 13-05 gate) | ❌ new | ⬜ pending |
| 13-03 T2 | 03 | 1 | LIFE-02 | T-13-07 | edge fns pass p_actor=user.id, bad_request guard | grep gate | `grep -l file_report supabase/functions/file-report/index.ts && grep -l flag_no_show supabase/functions/match-flag-no-show/index.ts` | ❌ new | ⬜ pending |
| 13-03 T3 | 03 | 1 | LIFE-02 | T-13-07 | named-export client wrappers w/ idemKey | grep gate | `grep -c "export function flagNoShow\|export function fileReport" apps/web/lib/after5/match.ts` | ✅ edit | ⬜ pending |
| 13-03 T4 | 03 | 1 | LIFE-02 | T-13-08/10 | confirm-gated producers; reason from enum only | Vitest | `pnpm vitest run apps/web/app/matches/[lockId]/__tests__/LockDetail.test.tsx` | ✅ extend | ⬜ pending |
| 13-04 T1 | 04 | 1 | LIFE-01 | T-13-11/13/14 | revoke_chat_thread keyed by lock, honors legal_hold, idempotent | grep gate (DDL) | `grep -v '^--' supabase/migrations/20260613142000_life01_cancel_closes_chat.sql \| grep -c revoke_chat_thread` | ❌ new | ⬜ pending |
| 13-04 T2 | 04 | 1 | LIFE-01 | T-13-11 | client gate denies write on closed/revoked thread | Vitest | `pnpm vitest run apps/web/app/messages/__tests__/thread-view.test.ts` | ✅ extend | ⬜ pending |
| 13-04 T3 | 04 | 1 | LIFE-01 | T-13-12 | read-only "this date was cancelled" banner, history preserved | grep gate | `grep -c "this date was cancelled\|cancelled" apps/web/app/messages/[threadId]/Conversation.tsx` | ✅ edit | ⬜ pending |
| 13-04 T4 | 04 | 1 | LIFE-01 | T-13-11 | thread closes on cancel (both branches) | pgTAP | `test -f supabase/tests/life01_cancel_closes_chat.sql && grep -c "chat_threads WHERE lock_id" supabase/tests/life01_cancel_closes_chat.sql` (asserts at 13-05 gate) | ❌ new | ⬜ pending |
| 13-05 T1 | 05 | 2 | LIFE-01..04 | T-13-15 | [BLOCKING] local migration apply → full suite green | pgTAP+Vitest+Deno | `pnpm db:test && pnpm vitest run && deno test --allow-none supabase/functions/process-jobs/handlers_test.ts` | ✅ | ⬜ pending |
| 13-05 T2 | 05 | 2 | LIFE-01..04 | T-13-16 | security advisor clean (no new ERROR) after DDL | Advisor (MCP/CLI) | `mcp__supabase__get_advisors type=security` (delta recorded in SUMMARY) | n/a | ⬜ pending |
| 13-05 T3 | 05 | 2 | LIFE-01..04 | T-13-17 | gated prod apply + edge-fn deploy + backfill (human only) | Manual checkpoint | human-action checkpoint (never autonomous) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test stubs/files the executing plans create before/with their implementation (each plan creates its own to keep file ownership clean for parallel waves):

- [ ] `supabase/functions/process-jobs/handlers_test.ts` — EXTEND with the three standby_roll kind cases + the bogus-kind reject + the time_range round-trip (LIFE-04, plan 13-01 Task 1, written RED before the fix).
- [ ] `supabase/tests/life03_standby_notify.sql` — NEW: (a) match_autowithdraw_user_conflicts flips queue to standby + dispatches standby_bumped (LIFE-03, plan 13-02 Task 4); (b) match_auto_roll dispatches standby_promoted to the promoted candidate (LIFE-03, plan 13-02 Task 5).
- [ ] `supabase/tests/life02_file_report.sql` — NEW: file_report writes a reports row (target_type='lock', reused enum), non-party raises 42501, RLS denies reporter_id<>auth.uid() (LIFE-02, plan 13-03 Task 1).
- [ ] `supabase/tests/life01_cancel_closes_chat.sql` — NEW: cancelled lock thread is state='closed' + revoked_at set, both safety and non-safety branches (LIFE-01, plan 13-04 Task 4).
- [ ] `apps/web/app/inbox/__tests__/StandbyList.test.tsx` — EXTEND with a status='standby' fixture + badge assertion (LIFE-03, plan 13-02 Task 3).
- [ ] `apps/web/app/matches/[lockId]/__tests__/LockDetail.test.tsx` — EXTEND with the report/no-show confirm-gated producer cases (LIFE-02, plan 13-03 Task 4).
- [ ] `apps/web/app/messages/__tests__/thread-view.test.ts` — EXTEND with the cancelled (state='closed') isMessageable=false row (LIFE-01, plan 13-04 Task 2).

No framework install needed — pgTAP, Vitest, and Deno-test harnesses all exist.

Note: the new pgTAP files (life01/life02/life03) and the extended b_complete-style DDL gates run GREEN only after the local migration apply in plan 13-05 (Wave 2). Their grep-gate `<automated>` checks in Wave 1 assert the test FILE/assertions exist; the actual DB execution is the Wave-2 gate.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Conflict-cascade fires on prod | LIFE-04 | Requires read-only prod inspection of job/lock/offer rows (Assumptions A1/A2/A3) | Plan 13-01 Task 3 — RESEARCH prod-verification queries (read-only MCP) |
| Gated prod apply + edge-fn deploy + data backfill | LIFE-01..04 | Prod mutation is human-gated (CLAUDE.md); never autonomous | Plan 13-05 Task 3 — checkpoint:human-action |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (manual-only items explicitly listed above with justification)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING (❌ new) references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (targeted per-task)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validation map populated by planner 2026-06-13; pending checker/auditor confirmation.
