---
phase: 7
slug: enhancements-and-polish-p3
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-05
---

# Phase 7 — Validation Strategy

> Per-phase validation contract. Source: 07-RESEARCH.md §Validation Architecture + each plan's `<verify>`.
> NOTE: planner MUST hydrate the Per-Task Verification Map + Wave 0 list from RESEARCH before this is nyquist_compliant.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Playwright (E2E, forced-local) + SQL assertion scripts (local Supabase stack) |
| **Quick run command** | `pnpm vitest run` (scoped) |
| **Full suite command** | `pnpm -w test` then the Phase-7 Playwright specs |
| **SQL run** | psql each `supabase/tests/e2*.sql` against the LOCAL stack after `supabase db reset` |
| **Type gate** | `pnpm --filter web exec tsc --noEmit` |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| (planner hydrates from RESEARCH §Validation Architecture) | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

(planner lists scaffolds from RESEARCH §Validation Architecture — the KEY one is `supabase/tests/e23_feed_contract.sql`: the feed-RPC re-CREATE keeps exactly the e10 + 3 host-hint + city_name columns, anon stays non-executable, keyset stable. Plus: per-stop-coords assertion (E20), withdraw_interest deny-non-owner + auth (E24), skeleton-renders-while-pending + archive-bucket (E25).)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual-verify @420px: real map in detail sheet, venue links (post-match), city label on card, standby/queue card, detail skeleton, archive tab | E20/E21/E23/E24/E25 | aesthetic/contrast/map-pin-color judgment | render forced-local @420px, critique vs 07-UI-SPEC |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Feed-RPC contract regression present (column set + anon-non-exec + keyset + host-hint preserved)
- [ ] Blind-contract guard: venue /places links do NOT render on the blind feed/offer surfaces (only post-match LockDetail)
- [ ] `nyquist_compliant: true` set once hydrated

**Approval:** pending
