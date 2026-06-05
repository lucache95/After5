---
phase: 01-navigation-profile-spine-p0
plan: 03
subsystem: navigation-profile-spine
tags: [preferences, settings, dating-toggle, refactor, e4]
requires:
  - DeepRouteHeader (01-02, Wave 1) — mounted on the new deep route
  - savePreferences / advanceOnboarding (@after5/api-client)
  - PreferencesInputSchema (@after5/validators)
provides:
  - apps/web/lib/after5/parseAgePref.ts (canonical int4range parser)
  - apps/web/components/PreferencesForm.tsx (mode-aware shared form + dating toggle)
  - apps/web/components/StickerChip.tsx (shared chip)
  - apps/web/app/account/preferences/page.tsx (auth-gated settings route)
affects:
  - apps/web/app/onboarding/steps/PreferencesStep.tsx (now a thin onboarding wrapper)
  - apps/web/app/onboarding/preferences/page.tsx (imports extracted parseAgePref)
tech-stack:
  added: []
  patterns:
    - mode-discriminated shared form (onboarding advances; account saves+stays)
    - deep-route SSR settings page (DeepRouteHeader, pb-20, no tab bar)
    - founder-overridable A3 dating-OFF = stop-new-exposure-only
key-files:
  created:
    - apps/web/lib/after5/parseAgePref.ts
    - apps/web/components/StickerChip.tsx
    - apps/web/components/PreferencesForm.tsx
    - apps/web/app/account/preferences/page.tsx
    - apps/web/components/__tests__/PreferencesForm.test.tsx
    - apps/web/app/account/preferences/__tests__/page.test.tsx
  modified:
    - apps/web/app/onboarding/steps/PreferencesStep.tsx
    - apps/web/app/onboarding/preferences/page.tsx
decisions:
  - "A3 (locked): dating OFF writes dating_enabled=false ONLY (stop new exposure); never cascades to active offers/locks. Founder-overridable, flagged in code + unit-asserted."
  - "Shared PreferencesForm holds BOTH mode branches; the onboarding advance/push is gated behind `if (mode === 'onboarding')` so account mode never touches onboarding (test-asserted) — this is the locked mode-aware extraction (Pattern 2)."
  - "parseAgePref extracted to one canonical module; onboarding inline copy removed (Pitfall 3, upper-exclusive '[lo,hi)')."
metrics:
  duration: ~25m
  completed: 2026-06-03
  tasks: 2
  files: 8
---

# Phase 1 Plan 03: Editable Dating Preferences (E4) Summary

Made dating preferences editable post-signup: extracted the onboarding `PreferencesStep` form body into a shared, mode-aware `<PreferencesForm>` (onboarding advances the step machine; account saves + sonner toast + stays), built a new auth-gated `/account/preferences` route that hydrates current prefs, and relocated the dating on/off toggle here from `EnableDatingButton` with a new ON→OFF "pause dating" path that stops new exposure only.

## What Was Built

**Task 1 — Shared mode-aware PreferencesForm (commit cad3413, A3-test 8d5c22f):**
- `lib/after5/parseAgePref.ts` — extracted the canonical `'[lo,hi)'` upper-exclusive int4range parser; onboarding's page imports it (inline copy removed).
- `components/StickerChip.tsx` — lifted the sticker chip out of `PreferencesStep` for shared use.
- `components/PreferencesForm.tsx` — `mode: 'onboarding' | 'account'` discriminator. Identical validation (`PreferencesInputSchema`) + persistence (`savePreferences`) in both modes; post-save tail forks: onboarding → `advanceOnboarding('phone_verify')` + `router.push('/onboarding/phone')`; account → `toast.success('preferences saved')` + `router.refresh()`. Embeds the relocated `DatingToggle` (account mode only) with the A3 OFF semantics + pause confirm.
- `PreferencesStep.tsx` → thin `<PreferencesForm mode="onboarding">` wrapper; onboarding behavior byte-for-byte preserved (existing `PreferencesStep.test.tsx` still green).
- `PreferencesForm.test.tsx` — 11 assertions: account-mode save-without-advance/push, onboarding-mode advance+push, invalid-input blocks save (both modes), `parseAgePref` upper-exclusivity, dating toggle both directions, and the A3 "write is dating_enabled-ONLY" guard.

**Task 2 — Auth-gated /account/preferences route (commit be6e71a):**
- `app/account/preferences/page.tsx` — `force-dynamic` SSR; `getUser()` → `redirect('/login?next=/account/preferences')` (V2); reads the prefs columns + `dating_enabled`; hydrates age via `parseAgePref`; `userId` derived server-side (V4); mounts `DeepRouteHeader backHref="/account"` (deep route, no tab bar); renders `<PreferencesForm mode="account">`.
- `page.test.tsx` — 4 assertions: login redirect, prefs hydration (incl. upper-exclusive age + `dating_enabled` passthrough), `DeepRouteHeader` mount, missing-row defaults.

## Verification

- `pnpm vitest run` on both spec files: **15 passed** — `PreferencesForm.test.tsx` 11 (10 at the original gate + 1 A3-hardening assertion) + `page.test.tsx` 4.
- Onboarding regression: full `apps/web/app/onboarding` suite **42 passed (9 files)**, including the original `PreferencesStep.test.tsx` (3 tests asserting save→advance→push).
- `pnpm -w typecheck`: **clean** (6/6 packages).
- Grep gates: `parseAgePref` extracted (no inline copy in onboarding page); route gated with `next=/account/preferences`; `mode="account"` present; no tab bar on the prefs page.

## Deviations from Plan

### Plan-gate inconsistency (documented, not a code defect)

**1. [Plan defect] Task 1 `<verify>` grep `! grep -qE "advanceOnboarding|/onboarding/phone" PreferencesForm.tsx` contradicts the plan's own `<action>`/`<interfaces>`.**
- The locked interface (plan lines 84–90) and `must_haves.truths` require the *single shared* `PreferencesForm` to drive BOTH modes, which necessarily places the onboarding branch (`advanceOnboarding` + `router.push('/onboarding/phone')`) inside the shared form, gated behind `if (mode === 'onboarding')`.
- The grep was written as if that branch would live in `PreferencesStep.tsx`, but the spec mandates extraction into the shared form. The grep is internally inconsistent with the architecture it accompanies.
- **Resolution:** kept the correct, spec-mandated architecture. The substantive safety invariant — "account mode never advances onboarding or pushes /onboarding/*" (Pitfall 2) — is enforced by the `mode === 'onboarding'` guard and proven by passing tests (account mode: `advanceOnboarding`/`push` not called). All other Task-1 gate clauses pass literally.

### Auto-additions (Rule 2)

**2. [Rule 2 — A3 hardening] Added a unit assertion that the dating-OFF write payload is `dating_enabled`-ONLY.**
- The A3 lock requires OFF to be least-destructive (no offer/lock cascade). Beyond the founder-overridable code comment, added a test asserting `Object.keys(payload) === ['dating_enabled']`, so a seeded active offer is provably untouched (nothing else is written/invoked). Commit 8d5c22f.

No bugs (Rule 1) or blocking issues (Rule 3) encountered. No architectural decisions (Rule 4) required. No auth gates.

## A3 (Dating-OFF Semantics) — Confirmation

Turning dating OFF writes `profiles.update({ dating_enabled: false })` and nothing else. The code carries `// A3: OFF = stop new exposure only; does NOT withdraw active offers/locks. Founder-overridable.` and the behavior is unit-asserted. The DB age-gate trigger remains the hard ON gate (not bypassed). A neutral ink-outline "pause dating" control with a one-line confirm (UI-SPEC copy) is used — no destructive red flood.

## Deferred / Pending

- **Live-render visual-verify: PENDING phase-end forced-local visual-verify.** Per the orchestrator's deferral, no `pnpm dev`/Playwright was started here (the default dev env is prod-pointed). Code + RTL assertions complete; the `<ui_verify>` 420px screenshot critique vs UI-SPEC §Surface 4 runs at the phase-end forced-local pass.
- **E2E persistence round-trip (edit→reload→persisted) + "URL never enters /onboarding/*" + "dating OFF leaves seeded active offer intact"** Playwright path: deferred to the same phase-end gate. The invariants are covered at the unit/component level (savePreferences round-trip via mock; account-mode never pushes /onboarding/*; A3 write is dating_enabled-only).

## Onboarding Flow Status

Compiles (typecheck clean) and passes: `PreferencesStep` is now a thin `mode="onboarding"` wrapper; the original onboarding regression test (save → advance → push to `/onboarding/phone`) is green, and the full onboarding suite (42 tests) passes.

## Self-Check: PASSED

All 6 created files exist on disk; all 3 per-task commits (cad3413, be6e71a, 8d5c22f) are in the git log.
