---
phase: 6
slug: trust-and-safety-p2
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 06-RESEARCH.md §Validation Architecture + each plan's `<verify>`.
> NOTE: planner MUST hydrate the Per-Task Verification Map + Wave 0 list from RESEARCH before this is nyquist_compliant.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit — packages + apps/web jsdom) + Playwright (E2E — apps/web/e2e) |
| **Config file** | `vitest.config.ts`, `vitest.workspace.ts`; Playwright config under `apps/web` |
| **Quick run command** | `pnpm vitest run` (scoped to touched packages) |
| **Full suite command** | `pnpm -w test` then the Phase-6 Playwright specs |
| **Type gate** | `pnpm --filter web exec tsc --noEmit` |
| **Estimated runtime** | unit ~60-90s; Playwright specs ~3-6 min forced-local |

---

## Sampling Rate

- **After every task commit:** quick unit run + `tsc --noEmit` for code tasks.
- **After every plan wave:** full unit suite + the Phase-6 Playwright specs.
- **Before completion:** full suite green + the safety-critical assertions (no-ack reconfirm does NOT auto-cancel; chat RLS denies a non-party; reliability recompute math).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| (planner hydrates from RESEARCH §Validation Architecture) | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

(planner lists the test scaffolds from RESEARCH §Validation Architecture — reliability-formula unit spec, chat-RLS deny-non-party SQL check, the two job-handler idempotency checks, the no-ack-no-autocancel assertion, the nav-edge Playwright spec.)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual-verify @420px: reliability badge ("new here" + score), reconfirm/check-in cards, chat-header nav edges | E17/E18/E19 | aesthetic/contrast judgment + warm-not-alarmist tone | render forced-local @420px, critique vs UI-SPEC |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] No 3 consecutive tasks without automated verify
- [ ] Safety-critical assertions present (no-autocancel, RLS deny, recompute math, poison-loop idempotency)
- [ ] `nyquist_compliant: true` set once hydrated

**Approval:** pending
