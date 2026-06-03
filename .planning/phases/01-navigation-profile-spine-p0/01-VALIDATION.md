---
phase: 1
slug: navigation-profile-spine-p0
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `01-RESEARCH.md` §Validation Architecture. Brownfield — existing test infra covers most requirements; no framework install needed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 (unit/integration, jsdom workspace for `apps/web`) + Playwright 1.49 (E2E) + jest-axe (a11y) |
| **Config file** | `vitest.workspace.ts`, `apps/web` Playwright config |
| **Quick run command** | `pnpm vitest run apps/web` |
| **Full suite command** | `pnpm vitest run && pnpm --filter web exec playwright test` |
| **Estimated runtime** | ~60–120s (vitest), Playwright E2E longer |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run apps/web` (scoped to touched files where possible)
- **After every plan wave:** full vitest suite + typecheck (`pnpm -w typecheck`)
- **Before `/gsd:verify-work`:** full suite green + Playwright nav-chrome E2E + **manual Playwright visual-verify** (render→screenshot→critique) per the standing UI rule
- **Max feedback latency:** ~120s

---

## Per-Requirement Verification Map

> Task IDs filled by the planner; rows are keyed by requirement until then.

| Requirement | E-item | Observable secure behavior | Test Type | Command / Method | Status |
|-------------|--------|----------------------------|-----------|------------------|--------|
| REQ-E1 | E1 | Every deep route + guard/error terminal renders `<DeepRouteHeader>` with a working back affordance to a deterministic parent (not a link-less terminal) | unit + E2E + visual | RTL render asserts header+back present on each route; Playwright walks each deep route and asserts a back control resolves; jest-axe on header | ⬜ pending |
| REQ-E2 | E2 | `BottomTabShell` "dates"→`/matches`, "profile"→`/account`; `UserMenu` profile→`/account`; active-state correct | unit | RTL/snapshot asserts tab `href` values + `isActive` for `/matches` & `/account` | ⬜ pending |
| REQ-E3 | E3 | `/account` shows identity (photo/name/age/city/verification) + dating-profile summary + ProfileCard self-view + edit/preferences/notifications links; no teaser content | unit + E2E + visual | RTL asserts identity fields + self-view trigger render; Playwright opens self-view sheet; visual critique vs UI-SPEC | ⬜ pending |
| REQ-E4 | E4 | Logged-in user edits age/distance/gender/dealbreakers + toggles dating on/off at `/account/preferences`; persists (idempotent `savePreferences`); off = stop new exposure only (no auto-cancel of active offers/locks) | unit + E2E | RTL form submit asserts `savePreferences` called with parsed int4range (`[lo,hi)` upper-exclusive); Playwright edit→reload→values persist; off-toggle asserts no cascade | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Reconcile/clean-tree check: confirm `main` checkout is the edit target; verify no pending mobile-UX worktree merge is mid-flight on `account`/`messages`/`my-nights` before editing (research landmine). Edit ONLY the main checkout, never a `.claude/worktrees/` copy.
- [ ] Test stubs for `<DeepRouteHeader>` and the `/account/preferences` mode-aware form extraction.

*Existing Vitest + Playwright + jest-axe infrastructure covers all phase requirements — no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Crafted visual quality of hub / header / preferences vs `01-UI-SPEC.md` 6-pillar bars + DESIGN-SYSTEM.md | REQ-E1/E3/E4 | Visual taste + Barbiecore conformance can't be asserted by RTL | Playwright render each surface at 420px → screenshot → critique against UI-SPEC pillars + visual rubric (standing rule) |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers the reconcile check + the new-component stubs
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set after planner fills task IDs

**Approval:** pending
