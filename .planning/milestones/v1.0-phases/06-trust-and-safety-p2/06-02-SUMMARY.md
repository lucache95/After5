---
phase: 06-trust-and-safety-p2
plan: 02
subsystem: chat / nav / trust
tags: [E18, REQ-E18, nav-edges, reveal-gating, chat-rls, e2e]
requires:
  - chat_threads_party_read RLS + chat_thread_party() helper (Phase 7, 20260601100100)
  - chat_threads.lock_id column (20260525124500_p2_chat_core)
  - DeepRouteHeader right slot (E1)
  - Phase 5 reveal (post-lock identity revealed)
provides:
  - chat→profile + chat→night reveal-gated nav controls (DeepRouteHeader right slot)
  - lock_id on the messages conversation loader
  - e18 4-edge E2E spec + chat-RLS deny-non-party SQL assertion (run in 06-05)
affects:
  - apps/web/app/messages/[threadId]/page.tsx
tech-stack:
  added: []
  patterns:
    - reveal-gating on lock_id (render-nothing pre-lock; no identity leak)
    - icon-only nav control = 44px tap target + focus ring + mandatory aria-label
    - verify-only RLS test (no create/drop policy; assert deny-non-party + allow-party)
key-files:
  created:
    - apps/web/e2e/e18-chat-nav-edges.spec.ts
    - supabase/tests/e18_chat_rls_denies_nonparty.sql
  modified:
    - apps/web/app/messages/[threadId]/page.tsx
decisions:
  - "Chat→Profile + Chat→Night BOTH point at /matches/[lockId] (the lock owns both the revealed profile and the night) — UI-SPEC §E18.1."
  - "Both controls quiet ink (text-shell-ink/70), no pink-flood — UI-SPEC default-both-quiet; pink reserved."
  - "Chat→Night icon = lucide CalendarHeart; Chat→Profile icon = lucide UserRound (both already-deps)."
  - "E2E proves the reveal gate with a SEPARATE pre-lock thread (lock_id null) that must render NEITHER control."
  - "SQL test is verify-only: asserts chat_threads_party_read pre-exists, then deny-non-party (0) + allow-party (1). NO create/drop policy (RESEARCH Pitfall 5 / T-06-06/T-06-07)."
metrics:
  duration_min: 4
  tasks: 2
  files: 3
  completed: 2026-06-05
---

# Phase 6 Plan 02: E18 chat↔profile↔night nav edges Summary

Reveal-gated chat→profile and chat→night quick-links wired into the existing DeepRouteHeader right slot of the conversation page, gated on the thread's `lock_id`, plus a 4-edge E2E and a verify-only chat-RLS deny-non-party SQL assertion (both authored for the 06-05 run).

## What was built

**Task 1 — loader + the two reveal-gated controls** (`apps/web/app/messages/[threadId]/page.tsx`, commit `3229552`)
- Added `lock_id` to the `chat_threads` select and to the thread result cast type (`lock_id: string | null`).
- Authored the `DeepRouteHeader` `right`-slot content: when `thread.lock_id != null`, two icon-only `next/link` controls in a `gap-2` flex row:
  - Chat→Profile — lucide `UserRound`, `aria-label="their profile"`, href `/matches/${lock_id}`.
  - Chat→Night — lucide `CalendarHeart`, `aria-label="the night"`, href `/matches/${lock_id}`.
  - Each is a 44px tap target (`h-11 w-11 rounded-full`) with `focus-visible:ring-4 ring-shell-accent/40`, quiet ink (`text-shell-ink/70`), `motion-reduce` honored — copied from the back-Link chrome.
- When `lock_id` is null (pre-lock thread) the `right` prop is `undefined` → no control renders (reveal-gated, no pre-lock identity leak — T-06-05).

**Task 2 — tests** (commit `5cbdaf8`)
- `apps/web/e2e/e18-chat-nav-edges.spec.ts` — forced-local authed (candidate party) session, 3 tests:
  1. locked chat header exposes `their profile` + `the night`, both `href=/matches/<lockId>`;
  2. a separate PRE-LOCK thread (lock_id null) renders NEITHER control (reveal gate);
  3. LockDetail still exposes Night→Profile (`see their profile`) + Night→Chat (`message <name>` → `/messages/<threadId>`) — the two existing edges, confirmed unchanged.
- `supabase/tests/e18_chat_rls_denies_nonparty.sql` — asserts `chat_threads_party_read` pre-exists + RLS enabled, then under the real `authenticated` role: non-party SELECT → 0 rows (deny), creator party → 1 row, candidate party → 1 row. Contains NO `create policy` / `drop policy` (verify-only).

## Verification

- `pnpm --filter web exec tsc --noEmit` — clean (run after each task).
- Task 1 grep gate: `lock_id` (7), `their profile` (1), `the night` (1) all present.
- Task 2 gate: both files exist; `their profile` in spec; `chat_threads` in SQL; **0** `create policy` in SQL.
- E2E + SQL EXECUTION is deferred to plan 06-05 (forced-local visual/gate pass + post-migration-apply SQL run) per the plan.

## The four edges (REQ-E18)

| Edge | Source | Status |
|------|--------|--------|
| Chat → Profile | DeepRouteHeader right slot (new) | reveal-gated on lock_id |
| Chat → Night | DeepRouteHeader right slot (new) | reveal-gated on lock_id |
| Night → Profile | LockDetail `see their profile` (existing) | confirmed unchanged |
| Night → Chat | LockDetail `message <name>` (existing) | confirmed unchanged |

Profile→Night is satisfied within LockDetail (the night renders in-page via PlanTimeline; from `/matches/[lockId]` the night and profile are the same surface).

## Deviations from Plan

None - plan executed exactly as written. No DB applied (no schema change in this plan). Prod untouched.

## Known Stubs

None. The controls are wired to real loader data (`thread.lock_id`); pre-lock render-nothing is intentional reveal-gating, not a stub.

## Self-Check: PASSED

- FOUND: apps/web/app/messages/[threadId]/page.tsx (modified, lock_id selected + controls)
- FOUND: apps/web/e2e/e18-chat-nav-edges.spec.ts
- FOUND: supabase/tests/e18_chat_rls_denies_nonparty.sql
- FOUND commit 3229552 (Task 1)
- FOUND commit 5cbdaf8 (Task 2)
