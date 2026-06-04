---
phase: 02-loop-closure-host-controls-p0
plan: 06
subsystem: host-controls-ui
tags: [api-client, host-ui, cancel-night, edit-night, vaul, sonner, barbiecore, a11y]
requires:
  - "cancel_night(p_actor,p_instance,p_idem_key) DEFINER RPC (Plan 02-04, 20260604122000) — LOCAL-applied"
  - "update_night(p_actor,p_instance,p_starts_at,p_duration_min,p_venue,p_ambient_sound_id,p_idem_key) DEFINER RPC (Plan 02-04, 20260604123000) — LOCAL-applied"
  - "regenerated Database types carrying cancel_night/update_night Args (packages/types/src/database.ts)"
  - "postNight wrapper shape (packages/api-client/src/feed.ts) — copied for the new wrappers"
  - "NightCard host surface + Barbiecore tokens (apps/web/app/my-nights/page.tsx)"
  - "CancelWithReasonPicker / MakeOfferModal vaul+sonner confirm pattern"
provides:
  - "cancelNight + updateNight typed api-client wrappers (read p_actor from client auth, generate UUID p_idem_key)"
  - "NightCardActions client leaf: cancel (vaul confirm) + edit (vaul sheet) host affordances on /my-nights seeking nights"
  - "affordance gating: cancel/edit render ONLY on the host's own status==='seeking' night; null otherwise"
  - "RPC errcode → dry host copy mapping (42501/P0001/P0002)"
affects:
  - "Phase 2 visual-verify checkpoint (forced-local Playwright pass owned by the orchestrator)"
  - "Prod apply of the E6/E7 RPCs (still GATED/batched — this plan is UI + api-client only, no DB change)"
tech-stack:
  added: []
  patterns: [api-client-rpc-wrapper, client-leaf-action, vaul-bottom-sheet, sonner-toast, errcode-mapping, status-gated-affordance]
key-files:
  created:
    - apps/web/app/my-nights/NightCardActions.tsx
    - apps/web/app/my-nights/__tests__/NightCardActions.test.tsx
  modified:
    - packages/api-client/src/feed.ts
    - packages/api-client/src/index.ts
    - packages/api-client/src/__tests__/feed.test.ts
    - apps/web/app/my-nights/page.tsx
    - apps/web/lib/after5/client.ts
    - .planning/REQUIREMENTS.md
decisions:
  - "p_actor is read from client.auth.getUser() inside the wrapper (the RPC re-checks p_actor = auth.uid()); the UI gate is convenience only — server is the authority (T-02-16)."
  - "update_night's generated Args type declares every p_* non-nullable, but the RPC treats null as 'leave unchanged'. The wrapper sends null for omitted fields and casts the args object `as never` to satisfy the strict generated type without weakening the public wrapper signature (optional fields)."
  - "crypto.randomUUID reached via globalThis with a narrow local type — the api-client tsconfig ships no DOM/node lib, and adding @types/node for one call was heavier than a typed accessor (Web Crypto is global in browser + Node >= 22, this package's engines floor)."
  - "NightCardActions renders OUTSIDE the card's <Link> (buttons-in-anchor is invalid HTML). The card return now wraps the link + an actions row in a div; the actions row only mounts for seeking nights."
  - "Edit form always exposes time + duration; venue + ambient fields render only when the server passes venues/ambientSounds lists (kept the surface minimal — the page does not yet load those lists, so the first cut edits time/duration). updateNight already accepts venue/ambient for when those lists are wired."
  - "Error copy mapped by PG errcode locally (not messageForCode, which is keyed on edge-function error NAMES, not PG codes). Stop-slop: specific, lowercase, no filler."
metrics:
  duration: ~22m
  completed: 2026-06-04
---

# Phase 2 Plan 06: Host Cancel/Edit UI on /my-nights Summary

Typed `cancelNight`/`updateNight` api-client wrappers plus a `NightCardActions` client leaf that surfaces a soft-cancel (vaul confirm) and an edit sheet (time/duration, with venue+ambient when supplied) on the host's own `seeking` nights at `/my-nights`, calling the E6/E7 DEFINER RPCs with sonner success toasts and errcode-mapped error toasts, styled to DESIGN-SYSTEM.md and gated so the affordances never render on a matched/completed/expired/cancelled card.

## What Was Built

**Task 1 — api-client wrappers (`packages/api-client/src/feed.ts`):**
- `cancelNight(client, { instance_id, idem_key? })` → `rpc('cancel_night', { p_actor, p_instance, p_idem_key })`.
- `updateNight(client, { instance_id, starts_at?, duration_min?, venue?, ambient_sound_id?, idem_key? })` → `rpc('update_night', {...})`, sending `null` for omitted fields (RPC leaves them unchanged).
- Both read `p_actor` from `client.auth.getUser()` and generate a UUID `p_idem_key` (idempotency ledger) when not supplied; both throw on RPC error.
- Exported from the package index and the `@/lib/after5/client` web barrel.
- 8 new unit tests (actor/idem-key wiring, supplied-key passthrough, omitted-field nulls, error throw).

**Task 2 — host UI (`NightCardActions.tsx` + wired into `page.tsx`):**
- `'use client'` leaf returning `null` unless `status === 'seeking'`.
- Cancel → vaul bottom-sheet confirm ("take it down?") → `cancelNight` → success toast + `router.refresh()`.
- Edit → vaul sheet (datetime-local time, duration minutes, optional venue/ambient `<select>`s) → `updateNight` → success toast + refresh.
- RPC errcodes mapped to dry copy: 42501 → "that's not your night to change.", P0002 → "that night's gone.", P0001/not_cancellable → "this night already matched — you can't take it down."
- Tokens only: `cn()`, `shell.*`, `font-heading`/`font-body`, `rounded-3xl`, `shadow-fun`, `min-h-[44px]`/`[48px]` targets, `focus-visible:ring-shell-accent/40`, `motion-reduce:*`. No hardcoded hex.
- Mounted in `NightCard` below the card `<Link>` (valid HTML); the `date_instances` query now also selects `duration_min, venue_id, ambient_sound_id`.
- 7 RTL + jest-axe tests: affordances render on seeking only, render nothing on matched/completed/cancelled/expired, cancel-confirm calls `cancelNight` + toasts, error path toasts (no success), edit-submit calls `updateNight` + toasts, no a11y violations.

**Task 3 — visual-verify checkpoint:** DEFERRED to the orchestrator (see below).

## Verification Results

- `pnpm vitest run packages/api-client/src/__tests__/feed.test.ts` — 12 passed.
- `pnpm vitest run apps/web/app/my-nights/__tests__/NightCardActions.test.tsx` — 7 passed.
- `pnpm -w typecheck` — GREEN (all 6 workspace packages, including @after5/api-client and @after5/web).

## Barbiecore / DESIGN-SYSTEM Conformance

Confirmed: `cn()` for all conditional classes (no string concat); `shell.*` semantic tokens only (no hex); `font-heading`/`font-body`; `rounded-3xl` sheets + `shadow-fun`; tap targets ≥44px (44px action buttons, 48px primary CTAs); `focus-visible:ring-shell-accent/40`; `motion-reduce:*` on the active-scale transitions; vaul bottom-sheets for confirm + edit; sonner toasts; lowercase, filler-free copy (stop-slop); semantic labels on the icon-bearing buttons. Reuses the verbatim vaul Drawer structure from `MakeOfferModal`.

## Deferred — Live Visual-Verify (Checkpoint, Task 3)

Per execution instructions, the forced-local Playwright visual-verify is **owned by the orchestrator**, not this executor: the default dev env is prod-pointed, so this agent did NOT start `pnpm dev` / Playwright. Code + RTL assertions are complete and green. The live-render pass — render `/my-nights` at 375px as a host with a `seeking` night, screenshot the NightCard with actions, exercise cancel + edit, critique against the DESIGN-SYSTEM rubric (tokens only, ≥44px, motion-reduce, WCAG AA), attach screenshot — remains **pending orchestrator forced-local visual-verify**.

## Deviations from Plan

**1. [Rule 3 - Blocking] `crypto` undeclared in api-client tsconfig**
- **Found during:** Task 1 typecheck (`TS2304: Cannot find name 'crypto'`).
- **Issue:** the package ships only `lib: ES2022` with no DOM/node lib, so the Web Crypto global is untyped.
- **Fix:** reach `crypto.randomUUID` through `globalThis` with a narrow local type + an unavailable-guard, instead of adding `@types/node` for one call.
- **Files modified:** packages/api-client/src/feed.ts
- **Commit:** bcf7692

**2. [Rule 3 - Blocking] `update_night` Args type non-nullable vs. null-as-unchanged contract**
- **Issue:** generated `update_night` Args declares every `p_*` as required/non-null; the wrapper must send `null` for omitted fields.
- **Fix:** keep the public wrapper fields optional, default omitted ones to `null`, cast the args object `as never` at the rpc boundary.
- **Files modified:** packages/api-client/src/feed.ts
- **Commit:** bcf7692

No other deviations — DB unchanged, no migrations, no prod apply, no new packages (vaul/sonner already in deps, T-02-SC accept holds).

## Known Stubs

Venue + ambient edit fields render only when the server passes `venues`/`ambientSounds` lists; `page.tsx` does not yet load those, so the first cut edits **time + duration**. This is intentional and not a goal-blocker — `updateNight` already accepts venue/ambient, and wiring the lists is a small follow-up. The cancel + time/duration-edit loop (the REQ-E6/E7 acceptance core) is fully wired.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface beyond the two RPC calls already in the plan's threat register (T-02-16/17 mitigated server-side; the UI gate is convenience).

## Self-Check: PASSED

- FOUND: apps/web/app/my-nights/NightCardActions.tsx
- FOUND: apps/web/app/my-nights/__tests__/NightCardActions.test.tsx
- FOUND: packages/api-client/src/feed.ts (cancelNight/updateNight)
- FOUND: .planning/phases/02-loop-closure-host-controls-p0/02-06-SUMMARY.md
- FOUND commit bcf7692 (Task 1 wrappers)
- FOUND commit 6afa71f (Task 2 UI)
