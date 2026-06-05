---
phase: 01-navigation-profile-spine-p0
plan: 01
subsystem: navigation
tags: [nav, bottom-tab, user-menu, ia, brownfield]
requires: []
provides:
  - "bottom-nav dates tab -> /matches"
  - "bottom-nav profile tab -> /account (real hub destination for E3)"
  - "UserMenu 'your profile' -> /account"
  - "REQ-E2 locked by unit tests"
affects:
  - apps/web/components/BottomTabShell.tsx
  - apps/web/components/UserMenu.tsx
tech-stack:
  added: []
  patterns: ["RTL + next/navigation usePathname mock for nav components"]
key-files:
  created:
    - apps/web/components/__tests__/BottomTabShell.test.tsx
  modified:
    - apps/web/components/BottomTabShell.tsx
    - apps/web/components/UserMenu.tsx
    - apps/web/components/__tests__/UserMenu.test.tsx
decisions:
  - "D-04: dates tab targets /matches (dates you're going ON), not /my-nights (nights you posted)"
  - "D-05: profile tab + UserMenu profile link target /account (the real hub), not the /home teaser"
metrics:
  duration: ~6m
  completed: 2026-06-03
---

# Phase 1 Plan 01-01: Bottom-Nav Semantics + Wave-0 Reconcile Gate Summary

Repointed the bottom-nav "dates" tab to `/matches` and the "profile" tab + UserMenu "your profile" link to `/account`, locked by new/extended unit tests — three single-line href edits plus the phase-wide Wave-0 clean-tree gate.

## What Was Built

- **Task 1 (Wave-0 reconcile gate):** Confirmed `GATE_PASS` — edit target is the `main` checkout, and none of the seven phase-shared files (`BottomTabShell.tsx`, `UserMenu.tsx`, `account/page.tsx`, `messages/[threadId]`, `offers/[offerId]`, `matches/[lockId]`, `dates/[slug]/interested`) show an in-progress merge conflict (`^UU`). No `.claude/worktrees/*` path was touched. This is a no-op gate (no file changes), so no commit was produced for it.
- **Task 2 (nav href edits):** `BottomTabShell.tsx` TABS — dates `href` `/my-nights` → `/matches` (D-04), profile `href` `/home` → `/account` (D-05). `UserMenu.tsx` MENU_ITEMS[0] ("your profile") `href` `/home` → `/account` (D-05). `isActive()` left unchanged; `pathname.startsWith(\`${href}/\`)` lights `/matches/*` as dates and `/account/*` as profile automatically. Labels, icons, keys, badge, and the planner-wedge link untouched.
- **Task 3 (unit tests):** Created `BottomTabShell.test.tsx` (mocks `usePathname` + stubs `InboxTabBadge`) asserting the tab href map (dates→`/matches`, profile→`/account`, discover→`/feed`, inbox→`/inbox`, create→`/create`), absence of any `/home` link, and active-state regression (`/matches/abc` lights dates, `/account` and `/account/preferences` light profile). Extended `UserMenu.test.tsx` to assert "your profile" → `/account` and absence of any `/home` menuitem.

## Verification

- `pnpm vitest run apps/web/components/__tests__/BottomTabShell.test.tsx apps/web/components/__tests__/UserMenu.test.tsx` — **14 passed (2 files, 660ms)**.
- `pnpm --filter web exec tsc --noEmit` — **clean (exit 0)**.
- Grep gate: no `href: '/home'` remains in either nav file (confirmed via `grep -rn account` showing `/account` at BottomTabShell:24 and UserMenu:29; `tsc` clean is the backstop).

## Deviations from Plan

None — plan executed exactly as written. All Rules 1–4 were no-ops; this was a pure brownfield href retarget plus tests.

**Note (tooling artifact, not a deviation):** the harness suppressed stdout for shell commands whose pattern literals contained the string `/account`, so the plan's inline `echo EDITS_OK` grep gate could not be observed printing. The edits were verified instead via `grep -rn "account"` (which printed the corrected lines in full) and a clean `tsc --noEmit`. No functional impact.

## Deferred / Blocked

- **Live visual-verify deferred (per orchestrator instruction):** did not start `pnpm dev` or run live Playwright screenshots/route-smoke (the orchestrator runs ONE consolidated visual-verify pass per wave to avoid dev-server port contention with the parallel plan). Code + RTL/unit assertions are complete; the live-render check (clicking profile tab lands on `/account`, dates tab lands on `/matches`) is **pending consolidated wave visual-verify**.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. Both targets (`/matches`, `/account`) are pre-existing auth-gated tab roots (`getUser()` → `redirect('/login?next=...')`); a repointed href cannot reach data the RLS/page gate does not already protect (T-01-01/T-01-02 dispositions hold).

## Commits

- `266ae21` fix(01-01): repoint dates tab to /matches and profile to /account
- `7d00708` test(01-01): lock bottom-nav + UserMenu tab map (REQ-E2)

## Self-Check: PASSED

- FOUND: apps/web/components/__tests__/BottomTabShell.test.tsx
- FOUND: apps/web/components/BottomTabShell.tsx (href: '/matches', href: '/account')
- FOUND: apps/web/components/UserMenu.tsx (href: '/account')
- FOUND commit: 266ae21
- FOUND commit: 7d00708
