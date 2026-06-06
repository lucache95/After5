---
phase: 10-generation-as-the-primary-night-path
plan: 03
subsystem: create-primary-path / phase-gate
tags: [flow-01, wiring-spec, offline, phase-gate, vitest, rtl]
requires:
  - "10-01 — generate is the dominant /create door; the + tab + UserMenu wedge route to /create/generate; demoted manual link"
  - "10-02 — POST /api/profile/city (self-RLS primary_city_id write + enqueueSeedCity); the funnel curated-city selector"
  - "CreateFlow / ImproveControls / PublishToFeedButton — the primary-path surfaces under test"
provides:
  - "FLOW-01 build+local-green gate: an OFFLINE RTL wiring spec proving the whole primary path is wired (city → generate → improve → publish) with no LLM/Foursquare/network"
affects:
  - "Phase 11 inherits the @420px visual-verify of the create surfaces (deferred here into the interactive Playwright-MCP audit)"
tech_stack:
  added: []
  patterns:
    - "Offline wiring gate: mock /api/create-plan + /api/profile/city + the generate-plan improve dispatch; stub the heavy ItineraryView to a marker so the test asserts FLOW, not chrome"
    - "Source-level assertion for the global entry routes (read BottomTabShell + UserMenu) so the + tab / wedge wiring is gated deterministically without a browser"
key_files:
  created:
    - "apps/web/app/create/__tests__/primary-path-wiring.test.tsx"
    - ".planning/phases/10-generation-as-the-primary-night-path/10-03-SUMMARY.md"
  modified: []
decisions:
  - "Reframed the phase gate to an OFFLINE wiring spec (vitest/RTL) rather than the planned live Playwright e2e + static @420px capture — the objective defers the @420px visual-verify to Phase 11's interactive Playwright-MCP audit (which already walks every route incl. /create), so a static capture spec here would be redundant work. The wiring is proven deterministically with mock generation; no live LLM/Foursquare key needed."
  - "No 10-visual-capture.spec.ts written — deferred, not skipped (recorded below + in ROADMAP)."
  - "No new migration (10-02 confirmed profiles_owner_all self-update suffices) → Phase 10 is app-code only, ships via Vercel on push, nothing to bundle into the Phase-8/9 key-gated cutover."
metrics:
  duration: "~12 min"
  completed: "2026-06-05"
  tasks: 1
  files_changed: 1
---

# Phase 10 Plan 03: Primary-Path Phase Gate Summary

Closed FLOW-01 with an offline RTL wiring spec that proves the whole primary night-creation path is wired end-to-end — pick a curated city → POST `/api/profile/city` → generate (mocked, no LLM) → improve a stop in place → publish to `/nights/new` — plus the dominant-generate / demoted-manual / global-route wiring. Local suite + typecheck green. No migration; Phase 10 is app-code only and ships on push. The @420px visual-verify of these create surfaces is deferred (not dropped) into Phase 11's interactive Playwright-MCP route audit.

## What Was Built

**Task — FLOW-01 primary-path wiring spec (offline).** `apps/web/app/create/__tests__/primary-path-wiring.test.tsx` (4 tests) asserts the five FLOW-01 wiring criteria deterministically, with generation, the city POST, and the improve dispatch all mocked (no `/api/create-plan` LLM call, no Foursquare key, no network):

1. **Dominant door + working manual escape** — `CreateChooser` renders generate as the one `bg-shell-accent` action routing to `/create/generate`; the demoted "or build from scratch" link is not a co-equal pink card and still drives `createBlankItinerary → /plans/<id>/edit` (no trap).
2. **Global entry routes** — source-level assertion that `BottomTabShell.tsx` (the `+` tab) and `UserMenu.tsx` (the wedge) both target `/create/generate`.
3. **City pick POSTs** — tapping the curated Kelowna chip in `CreateFlow` (authed) POSTs `{ cityId: <kelowna> }` to `/api/profile/city`.
4. **Generate → improve before publish** — the mocked generation lands a result where `ImproveControls` is present and precedes `PublishToFeedButton` in the DOM; a swap action calls the `generate-plan` improve dispatch (mocked) and persists in place.
5. **One publish path** — `PublishToFeedButton` routes to `/nights/new?itinerary=<id>`.

A fourth test pins the no-trap guarantee: a failed city save never disables the "make my date" CTA and generation still completes.

## Verification (local-green)

- New spec: **4/4 green** (`pnpm vitest run app/create/__tests__/primary-path-wiring.test.tsx`).
- Full create + city suites: **26/26 green** (`pnpm vitest run app/create app/api/profile/city`) — no regression in CreateChooser / ImproveControls / PublishToFeedButton / city-select.
- `pnpm exec tsc --noEmit` → **exit 0**.
- (The `Received true for a non-boolean attribute jsx/global` stderr line is styled-jsx noise from a child of the un-mocked StopCard tree, not from this spec, and does not fail any assertion.)

## Deviations from Plan

### Reframed gate (objective-directed, not an auto-fix)

The PLAN authored a live Playwright e2e (`10-create-primary.spec.ts`) + a static `@420px` capture (`10-visual-capture.spec.ts`) + a blocking human visual-verify checkpoint. The execution objective reframed this plan to an **offline wiring spec + local-green**, with the **@420px visual-verify deferred to Phase 11's interactive Playwright-MCP audit** (which already walks every route including `/create`). I therefore:
- Wrote the wiring proof as `primary-path-wiring.test.tsx` (offline vitest/RTL, mock generation) instead of a live Playwright spec — the plan explicitly allowed "vitest/RTL or a Playwright spec mirroring existing e2e — your call, but keep it OFFLINE."
- Did **not** write `10-visual-capture.spec.ts` and did **not** trigger the blocking checkpoint — the static capture would duplicate Phase 11's interactive audit of the same surfaces.

This is a directed scope change from the objective, recorded here for traceability; no Rule 1–3 auto-fixes were needed and no Rule 4 architectural decision arose.

## Visual-Verify Deferral

The @420px Barbiecore visual-verify of the create entry, the city picker, and the improve placement is **DEFERRED to Phase 11** — its interactive Playwright-MCP audit walks every route (incl. `/create` and `/create/generate`) against the design-system + nav rubric, so these surfaces are critiqued there rather than via a one-off static capture here. Deferred, not dropped (also flagged in ROADMAP Phase 11).

## Prod / Cutover Note

Phase 10 is **app-code only** — no migration (10-02 confirmed `profiles_owner_all` self-update is sufficient), no edge change. It ships via Vercel on push; there is **no gated prod-apply and nothing to bundle into the Phase-8/9 key-gated cutover**. The `enqueueSeedCity` enqueue wired in 10-02 no-ops harmlessly until the Phase-8/9 cutover (cold-start generation covers any unseeded city via the 08-04 warming fallthrough).

## Known Stubs

None. The wiring spec mocks generation by design (offline gate); the production path under test is fully wired (10-01/10-02 shipped the real city write + funnel + improve + publish).

## Self-Check: PASSED

- FOUND: apps/web/app/create/__tests__/primary-path-wiring.test.tsx
- FOUND commit 8f4d4bb (test(10-03): FLOW-01 primary-path wiring spec)
