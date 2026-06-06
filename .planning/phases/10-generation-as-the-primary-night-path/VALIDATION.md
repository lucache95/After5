---
phase: 10-generation-as-the-primary-night-path
nyquist_compliant: true
generated: 2026-06-05
---

# Phase 10 — Validation Map

Every task carries an executable `<automated>` verify command. No task relies on
manual-only verification except the single end-of-phase visual-verify checkpoint
(which is paired with automated screenshot capture in 10-03 Task 2).

## Per-Task Verify Map

| Plan | Task | Verify (automated) | Type |
|------|------|--------------------|------|
| 10-01 | 1 — demote manual door in CreateChooser | `pnpm vitest run app/create/__tests__/CreateChooser.test.tsx` | unit (tdd) |
| 10-01 | 2 — route + tab/CTA to funnel, no /places creation CTA | grep gate: `/create/generate` present in both nav files; zero venue-creation CTAs under /places | static gate |
| 10-02 | 1 — POST /api/profile/city (self-update + enqueue) | `pnpm vitest run app/api/profile/city/__tests__/route.test.ts` | unit (tdd) |
| 10-02 | 2 — city selector (id chips, prefill, post on confirm) | `pnpm vitest run app/create/__tests__/city-select.test.tsx` | unit (tdd) |
| 10-03 | 1 — e2e primary-path + local-green | `pnpm vitest run app/create app/api/profile/city` + `tsc --noEmit` + `playwright test e2e/10-create-primary.spec.ts` | e2e + typecheck |
| 10-03 | 2 — @420px visual-capture | `CAPTURE_VISUAL=1 playwright test e2e/10-visual-capture.spec.ts` + screenshot existence | e2e visual |
| 10-03 | 3 — human visual-verify | blocking checkpoint (paired with Task 2 automated capture) | checkpoint:human-verify |

## Nyquist Notes

- All code-producing tasks (10-01/1, 10-02/1, 10-02/2) are `tdd="true"` with explicit
  `<behavior>` blocks → tests written before/with implementation.
- 10-01 Task 2 is pure routing/wiring re-prioritization → static grep gate is sufficient
  (no behavioral logic added).
- The only human-only step (10-03 Task 3) is a visual rubric judgment that cannot be
  automated; it is backed by the automated @420px screenshot capture in 10-03 Task 2.

## Coverage of FLOW-01 Success Criteria

| ROADMAP criterion | Covered by |
|-------------------|------------|
| 1. Generation is the primary path; publishes to feed end-to-end | 10-01 (entry), 10-02 (city), 10-03/1 (e2e through publish) |
| 2. No dead/competing creation funnel (legacy retired/demoted) | 10-01 (demote + working manual + no /places CTA) |
| 3. Improve loop reachable in-flow before publish | 10-03/1 (improve step in e2e), 10-03/2 (visual placement) |
