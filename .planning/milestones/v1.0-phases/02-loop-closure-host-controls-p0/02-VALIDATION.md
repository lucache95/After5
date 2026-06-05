---
phase: 2
slug: loop-closure-host-controls-p0
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 2 — Validation Strategy

> Per-phase validation contract. Backend-heavy: migrations + DEFINER RPCs + cron/jobs + dispatch. Derived from `02-RESEARCH.md §Validation Architecture`. Migrations apply LOCAL-only this phase; PROD APPLY STAYS GATED.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | psql-assertion SQL (`pnpm db:test`) for RPC/migration behavior · Vitest for TS · Deno test for process-jobs handlers · `mcp__supabase__get_advisors type=security` after DDL |
| **Apply (local)** | `pnpm db:reset` (apply migrations to 127.0.0.1) → `pnpm db:types` (regen) → `pnpm -w typecheck` |
| **Quick run** | `pnpm db:test` + `pnpm vitest run apps/web` |
| **Full suite** | `pnpm db:test && pnpm vitest run && (deno test process-jobs) && pnpm -w typecheck` |

## Sampling Rate
- After every task commit: scoped psql/Vitest/deno test for the touched RPC/handler
- After every wave: full suite + `pnpm db:types` regen + security advisor (security, no high/critical new findings)
- Before `/gsd:verify-work`: full suite green + security advisor clean + LOCAL migrations applied cleanly from scratch (`pnpm db:reset`)
- **PROD apply is NOT part of verification — it is a separate gated, owner-approved step.**

## Per-Requirement Verification Map

| Requirement | E-item | Observable secure behavior | Test Type | Method | Status |
|-------------|--------|----------------------------|-----------|--------|--------|
| REQ-E9 | E9 | The 6 dead handlers + producers removed; queue cannot reference a missing RPC; `chat_purge`/`analytics_relay` untouched; fail-closed preserved | deno + unit | updated `handlers_test.ts` ALL_TYPES + `handlers_rpc_fail_closed_test.ts`; grep asserts handlers gone | ⬜ pending |
| REQ-E5 | E5 | lock active→completed + reachable `no_show`; `date_instances`→completed; past-dated seeking→`expired`; cron sweep enqueues correctly (after E9) | psql + job test | psql: seed lock past end → run sweep RPC → assert completed; seed no-show → assert no_show; seed past seeking → assert expired | ⬜ pending |
| REQ-E6 | E6 | `cancel_night` DEFINER re-checks creator=auth.uid(); soft-unpublish (status set, data kept, hidden from feed); dispatches `night_cancelled` to interested | psql | non-creator call rejected; creator call hides night + keeps queue rows + notifies interested | ⬜ pending |
| REQ-E7 | E7 | `update_night` DEFINER re-checks creator; edits starts_at/duration/venue/ambient (time_range is generated — not written); material change dispatches `night_changed` to interested | psql | non-creator rejected; time/venue edit notifies; ambient-only edit does not | ⬜ pending |
| REQ-E8 | E8 | `interest_received` dispatched from `match_ingest_interest` ONLY when n>0, deep-linked to `/dates/[slug]/interested`; email/push throttled via dedup_key | psql + unit | right-swipe → host notification row with correct deep-link; re-ingest (n=0) → no dup; notif-map.ts href asserts /dates/.../interested | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red*

## Wave 0 Requirements
- [ ] **E9 FIRST** (per audit dep): remove dead handlers + coupled tests before E5 schedules any new cron job.
- [ ] Confirm local supabase up; `pnpm db:reset` applies all existing + new migrations cleanly from scratch.
- [ ] psql-assertion test scaffolding for the new RPCs.

## Manual-Only Verifications
| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Security advisor clean after DDL | E5/E6/E7/E8 | Advisor is a live introspection, not a unit test | `mcp__supabase__get_advisors type=security` after `pnpm db:reset`; no new high/critical |
| Minimal cancel/edit UI on /my-nights + interested list | E6/E7 | Visual taste vs DESIGN-SYSTEM | execution-time Playwright forced-local render→screenshot→critique (small surfaces) |

## Validation Sign-Off
- [ ] Every task has an automated verify or a Wave-0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Security advisor run + clean after every DDL wave
- [ ] LOCAL migrations apply cleanly from scratch; prod apply explicitly deferred (gated)
- [ ] `nyquist_compliant: true` set after planner fills task IDs

**Approval:** pending
