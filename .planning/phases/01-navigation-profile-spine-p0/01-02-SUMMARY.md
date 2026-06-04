---
phase: 01-navigation-profile-spine-p0
plan: 02
subsystem: navigation-chrome
tags: [nav, deep-routes, back-chrome, a11y, e1, brownfield]
requires:
  - "lucide-react ArrowLeft (existing)"
  - "next/link (existing)"
  - "@/lib/cn (existing)"
provides:
  - "DeepRouteHeader — shared static-Link back-chrome primitive for deep routes"
  - "back affordance on all 6 deep routes + every link-less guard/error terminal"
affects:
  - "apps/web/app/matches/[lockId]/page.tsx"
  - "apps/web/app/matches/[lockId]/rate/page.tsx"
  - "apps/web/app/offers/[offerId]/page.tsx"
  - "apps/web/app/messages/[threadId]/page.tsx (and /inbox/[threadId] re-export)"
  - "apps/web/app/dates/[slug]/interested/page.tsx"
  - "apps/web/app/account/notifications/page.tsx"
tech-stack:
  added: []
  patterns:
    - "server-component static-Link back chrome (no client directive / nav hooks)"
    - "deterministic backHref per route (D-08) — never a browser-history pop"
    - "guard/error <main> wrapped in a fragment with the same header (no dead-ends)"
key-files:
  created:
    - apps/web/components/DeepRouteHeader.tsx
    - apps/web/components/__tests__/DeepRouteHeader.test.tsx
  modified:
    - apps/web/app/matches/[lockId]/page.tsx
    - apps/web/app/matches/[lockId]/rate/page.tsx
    - apps/web/app/offers/[offerId]/page.tsx
    - apps/web/app/messages/[threadId]/page.tsx
    - apps/web/app/dates/[slug]/interested/page.tsx
    - apps/web/app/account/notifications/page.tsx
    - apps/web/e2e/route-smoke.spec.ts
decisions:
  - "DeepRouteHeader is a SERVER component (pure <Link>) — drops into SSR pages + guard branches with no client boundary"
  - "Back target is a static backHref prop per route (D-08), never history.back()/router.back() — cold-entered deep routes do not exit the app"
  - "offers AccountGate branch also wrapped with the header even though it already has a CTA — guarantees a uniform back-to-/inbox affordance"
  - "notifications page kept its existing single <h1> (header passes no title) to preserve one-h1-per-surface a11y; switched pb-28→pb-20 (deep route, no nav clearance)"
metrics:
  duration: ~35m
  completed: 2026-06-03
---

# Phase 1 Plan 02: DeepRouteHeader + universal deep-route back chrome (E1) Summary

Shared server-component `<DeepRouteHeader>` (static `backHref` <Link>, never a browser-history pop) mounted on all 6 deep routes and every previously link-less guard/error terminal, so a user who cold-enters a deep route or hits a guard can always navigate back to a tab root — no dead-end remains.

## What shipped

- **`DeepRouteHeader.tsx`** — new pure-`<Link>` server component: sticky masthead-style chrome mirroring `/account`, a 44px (`h-11 w-11`) `ArrowLeft` back control carrying `aria-label={backLabel}` + `focus-visible:ring-shell-accent/40`, an optional lowercase `font-heading` title (`line-clamp-1`), and an optional `right` slot. No `'use client'`, no `useRouter`/`usePathname`, no history pop.
- **`DeepRouteHeader.test.tsx`** — RTL + jest-axe: asserts the back link's `href` + accessible name, title presence/absence, the right slot, and zero a11y violations. 5/5 green.
- **6 deep-route pages** — happy path + every guard/error `<main>` now render `<DeepRouteHeader>` with the static back targets below. Guard copy aligned to 01-UI-SPEC.
- **`route-smoke.spec.ts`** — new E1 describe block visiting each reachable deep route as a party + the "not your offer" guard as a non-party outsider, asserting a visible `<a href>` back control (static Link, not a JS button) that resolves to and navigates to its documented parent.

## Routes where DeepRouteHeader is mounted (static back targets, D-08)

| Route | backHref | backLabel | title |
|-------|----------|-----------|-------|
| `/matches/[lockId]` (happy + 2 guards) | `/matches` | back to matches | counterpart first_name |
| `/matches/[lockId]/rate` (form + not-yet + already-rated) | `/matches/[lockId]` | back to your match | — |
| `/offers/[offerId]` (happy + not-your-offer + AccountGate) | `/inbox` | back to inbox | host first_name |
| `/messages/[threadId]` (happy + not-your-conversation) | `/inbox` | back to inbox | counterpart first_name |
| `/inbox/[threadId]` (re-export — inherits, NOT forked) | `/inbox` | back to inbox | counterpart first_name |
| `/dates/[slug]/interested` (happy + not-your-date) | `/my-nights` | back to your nights | your interest |
| `/account/notifications` (clean main) | `/account` | back to your account | — (kept page h1) |

No `BottomTabShell` is mounted on any of these routes (D-07-nav).

## Verification

- `pnpm vitest run apps/web/components/__tests__/DeepRouteHeader.test.tsx` — **5 passed**, jest-axe clean.
- Grep gate: all 6 page files contain `DeepRouteHeader`; zero `history.back`/`router.back` across the deep routes; `DeepRouteHeader.tsx` contains no `'use client'`/`useRouter`/`usePathname`/history-pop.
- `pnpm -w typecheck` — **6/6 successful, clean**.
- Touched-area component tests (`apps/web/app/matches|offers|dates`, `apps/web/components`) — **137 passed**.
- `route-smoke.spec.ts` — compiles, type-checks, lint-clean (eslint exit 0); all 3 new E1 tests discovered by `playwright --list`. **Live browser run deferred** (see below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — missing critical functionality] `/account/notifications` login redirect dropped the deep-link target**
- **Found during:** Task 2
- **Issue:** the page gated with `redirect('/login')` (no `?next=`), so a cold-entered notifications deep-link would not return the user to the page after login — inconsistent with the V2 auth-gate pattern every other deep route uses and counter to the cold-entry premise of this phase.
- **Fix:** changed to `redirect('/login?next=/account/notifications')`.
- **Files modified:** `apps/web/app/account/notifications/page.tsx`
- **Commit:** `0de4c3b`

### Intentional design choices (within Claude's discretion / D-07-nav)

- `offers/[offerId]` `AccountGate` branch was wrapped with the header for a uniform back-to-`/inbox` affordance even though `AccountGate` already renders a CTA link (it was not strictly a link-less terminal). Additive, no behavior change to `AccountGate.tsx` (shared component left untouched).
- `account/notifications` keeps its own `<h1>` and the header passes no `title`, preserving one-`<h1>`-per-surface a11y; its container moved `pb-28 → pb-20` per UI-SPEC deep-route spacing (no bottom-nav clearance).

## Deferred / Pending

- **Live Playwright route-smoke run (Task 3 `<automated>`):** deferred to the orchestrator's consolidated per-wave run. A Next dev server is already up on :3000 and was started outside this executor; per the brief, `.env.local` points the dev server at PROD and the Playwright config only overrides Supabase env for a *spawned* server, so running against the existing :3000 server risks a prod-pointed app (seed writes go to local 54321) and port contention with the user's session. The spec is proven compile/type/lint-clean with all 3 E1 tests discovered; the code under test is green via typecheck + 137 component tests. **Pending consolidated wave visual-verify + live route-smoke.**
- **Standing visual-verify (`<ui_verify>` on Tasks 1–2):** render at 420px → screenshot → critique vs 01-UI-SPEC §Surface 2. **Pending consolidated wave visual-verify** (orchestrator runs one pass per wave to avoid port contention).

## Known Stubs

None. No hardcoded empty data flows to UI; the header renders real per-route props (counterpart/host names, static parent routes).

## Authentication Gates

None encountered — no auth gate hit during execution.

## Self-Check: PASSED

- FOUND: apps/web/components/DeepRouteHeader.tsx
- FOUND: apps/web/components/__tests__/DeepRouteHeader.test.tsx
- FOUND: apps/web/e2e/route-smoke.spec.ts
- FOUND: .planning/phases/01-navigation-profile-spine-p0/01-02-SUMMARY.md
- FOUND commit 19797b8 (Task 1), 0de4c3b (Task 2), 204b5e1 (Task 3)
