---
phase: 6
slug: trust-and-safety-p2
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
hydrated: 2026-06-05
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 06-RESEARCH.md §Validation Architecture + each plan's `<verify>`.
> Hydrated by the planner: Per-Task Verification Map + Wave 0 list filled; the 4 safety-critical assertions mapped.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit — packages + apps/web jsdom) + Playwright (E2E — apps/web/e2e) + SQL assertion scripts (local Supabase stack; no pgTAP harness in-tree) |
| **Config file** | `vitest.config.ts`, `vitest.workspace.ts`; Playwright config under `apps/web` |
| **Quick run command** | `pnpm vitest run` (scoped to touched packages) |
| **Full suite command** | `pnpm -w test` then the Phase-6 Playwright specs |
| **SQL run** | pipe each `supabase/tests/e1*.sql` through psql to the LOCAL stack after `supabase db reset` (a RAISE = non-zero exit = fail) |
| **Type gate** | `pnpm --filter web exec tsc --noEmit` |
| **Estimated runtime** | unit ~60-90s; SQL scripts ~seconds each; Playwright specs ~3-6 min forced-local |

---

## Sampling Rate

- **After every task commit:** quick unit run + `tsc --noEmit` for code tasks; the touched `supabase/tests/*.sql` against the local stack for DDL tasks.
- **After every plan wave:** full unit suite + `tsc --noEmit`; SQL scripts after a local `supabase db reset`.
- **Before completion (06-05 gate):** full suite green + advisor clean + ALL four SQL scripts + the e18 Playwright spec + the 4 safety-critical assertions (no-ack reconfirm does NOT auto-cancel; chat RLS denies a non-party; reliability recompute math incl. no_show + new-until-3; handler poison-loop idempotency) + visual-verify @420px.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 06-01 T1 | 06-01 | 1 | REQ-E17 | reliability_score written only by recompute (no client path) | unit (pure fn) | `pnpm vitest run packages/business/src/reliability.test.ts` | ⬜ pending |
| 06-01 T2 | 06-01 | 1 | REQ-E17 | recompute_reliability search_path pinned + revoke-all; aggregate-only (no raw-rating leak) | migration grep + (apply in 06-05) | grep gate in plan; `supabase/tests/e17_recompute_reliability.sql` (06-05) | ⬜ pending |
| 06-01 T3 | 06-01 | 1 | REQ-E17 | reliability surfaced as aggregate pill only; aria-label | component (jsdom) | `pnpm vitest run apps/web/components/__tests__/ProfileCard.test.tsx` + `tsc --noEmit` | ⬜ pending |
| 06-01 T4 | 06-01 | 1 | REQ-E17 | **SAFETY-CRITICAL:** no_show-as-missed + new-until-3 recompute math + idempotent | SQL/local-apply | `supabase/tests/e17_recompute_reliability.sql` (run 06-05) | ⬜ pending |
| 06-02 T1 | 06-02 | 1 | REQ-E18 | pre-lock identity not leaked (reveal-gated on lock_id) | type + grep | `tsc --noEmit` + grep lock_id/aria-labels | ⬜ pending |
| 06-02 T2a | 06-02 | 1 | REQ-E18 | 4 nav edges + reveal-gating + aria-labels | E2E (Playwright) | `apps/web/e2e/e18-chat-nav-edges.spec.ts` (run 06-05) | ⬜ pending |
| 06-02 T2b | 06-02 | 1 | REQ-E18 | **SAFETY-CRITICAL:** chat_threads_party_read DENIES a non-party (verify-only, no DDL) | SQL/local-apply | `supabase/tests/e18_chat_rls_denies_nonparty.sql` (run 06-05) | ⬜ pending |
| 06-03 T1 | 06-03 | 1 | REQ-E19 | dispatch RPCs search_path pinned + revoke-all; no status mutation (soft posture) | migration grep + (apply 06-05) | grep gate in plan; `supabase/tests/e19_safety_handlers.sql` (06-05) | ⬜ pending |
| 06-03 T2 | 06-03 | 1 | REQ-E19 | handlers route to never-raise dispatch RPCs | grep | grep day_of_reconfirm/safety_checkin handlers | ⬜ pending |
| 06-03 T3 | 06-03 | 1 | REQ-E19 | soft cards, no red, no auto-cancel (reuse cancel flow) | type + grep | `tsc --noEmit` + grep titles + no bg-red/destructive | ⬜ pending |
| 06-03 T4 | 06-03 | 1 | REQ-E19 | **SAFETY-CRITICAL:** both handlers dispatch; poison-loop idempotency (never-raise on cancelled lock); no-ack does NOT auto-cancel | SQL/local-apply | `supabase/tests/e19_safety_handlers.sql` (run 06-05) | ⬜ pending |
| 06-04 T1 | 06-04 | 2 | REQ-E19 | CREATE OR REPLACE (grants survive); search_path preserved; reciprocal path wired | migration grep + (apply 06-05) | grep gate in plan; `supabase/tests/e19_producers.sql` (06-05) | ⬜ pending |
| 06-04 T2 | 06-04 | 2 | REQ-E19 | both lock paths enqueue both jobs (reciprocal coverage) | SQL/local-apply | `supabase/tests/e19_producers.sql` (run 06-05) | ⬜ pending |
| 06-05 T1 | 06-05 | 3 | E17/E18/E19 | local apply + advisor clean (no new HIGH, no USING(true), search_path pinned) | full suite + advisor + all SQL/E2E | `pnpm -w test` + `tsc --noEmit` + all `supabase/tests/e1*.sql` + e18 spec | ⬜ pending |
| 06-05 T2 | 06-05 | 3 | E17/E18/E19 | warm-not-alarmist, no red, on-brand | manual visual-verify @420px | human checkpoint (forced-local render) | ⬜ pending |
| 06-05 T3 | 06-05 | 3 | E17/E18/E19 | gated prod-apply (NOT autonomous) | human checkpoint | MCP apply_migration to prod (human) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Nyquist check:** every code/DDL-producing task has an automated `<verify>` or a Wave-0 scaffold it is verified against. No 3 consecutive tasks lack automated verify (the only manual-only tasks are the two 06-05 human checkpoints, both terminal gates, each preceded by the automated 06-05 T1).

---

## Wave 0 Requirements

Test scaffolds authored alongside their slice (each slice writes its own failing tests first, per MVP vertical-slice ordering), all EXECUTED in 06-05 against the local stack:

- [ ] `packages/business/src/reliability.test.ts` (06-01 T1) — formula weights + >=3 threshold + badgeFor mapping (pure-fn unit, runs immediately)
- [ ] `apps/web/components/__tests__/ProfileCard.test.tsx` (06-01 T3, EXTEND) — new-member vs established pill + aria-label (jsdom, runs immediately)
- [ ] `supabase/tests/e17_recompute_reliability.sql` (06-01 T4) — **no_show feed + new-until-3 + idempotent recompute** (SAFETY-CRITICAL recompute math)
- [ ] `supabase/tests/e18_chat_rls_denies_nonparty.sql` (06-02 T2b) — **chat RLS denies a non-party** (SAFETY-CRITICAL; verify-only, no `create policy`)
- [ ] `apps/web/e2e/e18-chat-nav-edges.spec.ts` (06-02 T2a) — the 4 nav edges + reveal-gating + aria-labels (forced-local Playwright)
- [ ] `supabase/tests/e19_safety_handlers.sql` (06-03 T4) — **both handlers dispatch; poison-loop idempotency (never-raise on cancelled lock); no-ack does NOT auto-cancel** (SAFETY-CRITICAL ×2)
- [ ] `supabase/tests/e19_producers.sql` (06-04 T2) — both lock RPCs enqueue both jobs with correct dedup keys (reciprocal coverage)

**The 4 safety-critical automated assertions (all present above):**
1. A no-ack reconfirm does NOT auto-cancel the lock → `e19_safety_handlers.sql` (assertion d)
2. Chat RLS denies a non-party → `e18_chat_rls_denies_nonparty.sql`
3. Reliability recompute math (no_show-as-missed + new-until-3) → `e17_recompute_reliability.sql` + `reliability.test.ts`
4. Each safety handler is idempotent / never-raise (poison-loop safety) → `e19_safety_handlers.sql` (assertion c)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual-verify @420px: reliability badge ("new here" + score), reconfirm/check-in cards, chat-header nav edges | E17/E18/E19 | aesthetic/contrast judgment + warm-not-alarmist tone | render forced-local @420px, critique vs 06-UI-SPEC.md (06-05 T2) |
| Gated prod-apply of the 3 migrations + process-jobs redeploy | E17/E18/E19 | secure-by-default gated-prod-apply rule — prod changes never autonomous | human applies via MCP apply_migration in dependency order, runs prod advisor (06-05 T3) |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] No 3 consecutive tasks without automated verify
- [x] Safety-critical assertions present (no-autocancel, RLS deny, recompute math, poison-loop idempotency)
- [x] `nyquist_compliant: true` set once hydrated

**Approval:** approved
