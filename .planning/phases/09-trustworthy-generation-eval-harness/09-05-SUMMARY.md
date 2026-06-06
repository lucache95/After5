---
phase: 09-trustworthy-generation-eval-harness
plan: 05
subsystem: generate-plan improve loop (single-stop swap + NL tweaks) + /create improve UI
tags: [plan-02, improve-loop, single-slot-repick, nl-knobs, haiku, tool-use, coherence, update_itinerary_stops]
requires:
  - "withinHop + MAX_HOP_KM + isOpenAt (scoring.ts, Plan 09-01)"
  - "haversineKm + filterPlaces (places-filter.ts)"
  - "update_itinerary_stops RPC (m3 + e11 — 7-arg owner-checked write path)"
  - "@anthropic-ai/sdk@0.40.1 (edge pins npm:@anthropic-ai/sdk@^0.40.0)"
provides:
  - "repickSlot — deterministic single-slot re-pick holding other stops, re-validating proximity against both neighbors"
  - "NL_TWEAK_TOOL + extractKnobs — forced Haiku tool-use → constrained {budget_delta, vibe, intent, time_shift} knobs"
  - "applyKnobsToInputs — pure knob→PlanInputs mapping for the pipeline re-run"
  - "validateCoherence — surfaces hop/budget/hours breaks (does not persist on break)"
  - "handleImprove — index.ts dispatch (action swap_stop|nl_tweak) persisting via update_itinerary_stops with the JWT owner check"
  - "ImproveControls — per-stop tweak + NL input UI in /create's authed result"
affects:
  - supabase/functions/generate-plan/improve.ts
  - supabase/functions/generate-plan/index.ts
  - apps/web/app/create/CreateFlow.tsx
  - apps/web/app/create/ImproveControls.tsx
tech-stack:
  added: []
  patterns:
    - "Forced Anthropic tool-use for a CONSTRAINED knob schema (intent/time_shift enums) — LLM classifies the wish, never executes free text (T-09-11)"
    - "Single-slot re-pick: hold other place_ids as used, re-score same-type candidates, re-validate withinHop against BOTH neighbors"
    - "Mandatory coherence re-validation post-change: surface, do NOT persist on break (T-09-13)"
    - "Caller-scoped (anon-key + JWT) edge client so update_itinerary_stops' auth.uid() owner check applies (T-09-12) — NOT the service-role client"
key-files:
  created:
    - supabase/functions/generate-plan/improve.ts
    - supabase/functions/generate-plan/improve.test.ts
    - apps/web/app/create/ImproveControls.tsx
    - apps/web/app/create/__tests__/ImproveControls.test.tsx
  modified:
    - supabase/functions/generate-plan/index.ts
    - apps/web/app/create/CreateFlow.tsx
decisions:
  - "NL-knob set = {budget_delta (±200 clamp), vibe[], intent (enum), time_shift (earlier|later|none)} — the smallest set that grants cheaper/more-romantic/later without letting the LLM touch structure"
  - "Swap re-validates against BOTH neighbors (i-1 and i+1) via withinHop, not just the predecessor — a mid-plan swap can't strand the following stop"
  - "NL tweak re-flows every stop against the new knobs (reflowStops) rather than re-running the full LLM pipeline in the edge dispatch — keeps the improve call cheap + deterministic; the structure invariant holds (no LLM place-picking)"
  - "Improve dispatch lives behind an action discriminator in the EXISTING generate-plan serve handler (CONTEXT discretion) — one function, zod-validated, auth-required, caller-JWT client"
  - "Coherence break returns HTTP 409 with issues[]; the UI renders the first issue as a sonner toast and never updates the itinerary"
metrics:
  duration: ~25 min
  completed: 2026-06-05
---

# Phase 9 Plan 05: Improve Loop (Single-Stop Swap + NL Tweaks) + /create Improve UI Summary

The customize/improve loop: a user can swap a single stop (deterministic re-pick of just that slot + a cheap Haiku copy rewrite of only that stop) and apply natural-language tweaks ("cheaper", "more romantic", "later") that Haiku parses into constrained scoring knobs. After any change the itinerary is re-validated for proximity + budget + hours; an incoherent change is surfaced (HTTP 409 + a sonner toast), never silently shipped. All writes go through the owner-checked `update_itinerary_stops` RPC.

## What Was Built

### Task 1 — Single-slot re-pick + NL-knob parse + re-validate (commit f0f9cf2)
- `improve.ts` with PURE, unit-testable core (no SDK/Supabase at type-check time, mirroring 09-01's `extractToolUseItineraries`):
  - `repickSlot(stops, i, candidates, inputs)` — re-picks ONLY slot `i`, holding every other stop's place_id as used. Candidate must match the swapped stop's `place_type`, be open at its slot time (`isOpenAt`), and be within hop of BOTH neighbors (`withinHop`, Plan 09-01). Nearest in-hop, highest-quality wins. Never invents a place — returns `no_alternative` on a thin pool.
  - `NL_TWEAK_TOOL` + `extractKnobs` — forced Haiku `tool_choice` emits `{budget_delta, vibe, intent, time_shift}`; `extractKnobs` clamps `budget_delta` to ±200, drops out-of-enum `intent`/`time_shift`, and returns a safe zero-knob when no tool_use block is present (the free text is never executed — T-09-11).
  - `clampTweakText` — length-caps free text to 280 chars BEFORE the Haiku call (prompt-injection mitigation).
  - `applyKnobsToInputs` — pure knob→PlanInputs mapping (budget floored at 0, vibe union, intent override, time_of_day shift).
  - `validateCoherence` — re-validates every consecutive hop (`withinHop`), the budget sum against `max(budget*1.3, 50)`, and each stop's hours; returns human-readable issues (e.g. "this swap puts you 8.0km from the next stop").
  - `handleImprove` — the impure dispatch: loads the owner's itinerary, performs swap or NL re-flow, refreshes ONLY the swapped stop's copy via one Haiku call (Pitfall 4 — stale prose can't name a removed venue; the old `what_to_do` is cleared on swap), re-validates, and persists via `update_itinerary_stops` ONLY. On incoherence it returns 409 + issues without persisting (T-09-13). A non-owner is rejected (42501 → 403, T-09-12).
- `index.ts` — added an `action` discriminator: a body with `action: 'swap_stop' | 'nl_tweak'` routes to `handleImprove` with a **caller-scoped client** (anon key + the request's `Authorization` JWT) so the RPC's `auth.uid()` owner check applies. zod validation + auth-required (401 without a JWT) preserved; the generate path is untouched.

### Task 2 — Improve-loop UI in /create (commit af6592c)
- `ImproveControls.tsx` — a per-stop "tweak" button (single-stop swap) + a free-text "tweak the whole night" input ("cheaper · more romantic · later"). Both call the improve dispatch via `browserAfter5Client().functions.invoke('generate-plan', { body })` (the session JWT rides automatically). A coherence break (`{ ok:false, issues }`, including the structured body read from a non-2xx `FunctionsHttpError`) renders as a `sonner` error toast — never a silent swap. On success the new stops are handed back to the parent.
- `CreateFlow.tsx` — extracted the authed branch into `AuthedResult`, which holds the active itinerary's stops in local state so a swap/tweak updates the rendered `ItineraryView` in place, and mounted `ImproveControls` above the publish CTA.
- Barbiecore + mobile-first per DESIGN-SYSTEM.md: `shell.*` tokens, `font-heading`/`font-body`, lowercase/dry copy, ≥44px tap targets (`min-h-[44px]`), `cn()`, ARIA labels on the icon buttons, no raw hex.

## Verification

- `deno test improve.test.ts --allow-env --allow-read --no-check --node-modules-dir=auto` — **18/18 green** (repickSlot holds/excludes/re-validates + no-invent; validateCoherence surfaces hop/budget/hours; knob mapping + budget floor; clampTweakText cap/trim; extractKnobs clamp/drop/safe-zero; schema enums).
- Full `generate-plan` deno suite — **85 passed / 0 failed** (was 67 in 09-01; +18 new).
- `pnpm --filter web test -- ImproveControls` — **6/6 green** (renders affordances; swap_stop dispatch + in-place update; NL tweak; coherence toast not silent swap; FunctionsHttpError body read; ≥44px tap target). Full `app/create` suite 12/12.
- `pnpm --filter web typecheck` — clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `deno test --node-modules-dir=auto` clobbered the pnpm root `node_modules`, breaking vitest**
- **Found during:** Task 2 (first vitest run).
- **Issue:** Running the canonical 09-01 deno command (`--node-modules-dir=auto`) from the repo converted the root `node_modules` into a Deno-managed `.deno` layout, removing the pnpm `react`/`react-dom` symlinks. vitest then threw `Cannot read properties of null (reading 'useState')` on EVERY web test (CreateChooser failed too — confirming it was the env, not my code).
- **Fix:** `pnpm install --frozen-lockfile` restored the pnpm layout (lockfile-pinned, no new packages — the package-install exclusion does not apply). After restore, all web tests pass.
- **Note for downstream plans:** running any `deno test --node-modules-dir=auto` in this repo mutates the shared root `node_modules`; follow it with `pnpm install --frozen-lockfile` before running vitest. (The deno command still works for the edge tests; it just needs the pnpm restore afterward for the JS test runner.)

## Known Stubs

None. The swapped-stop copy rewrite is best-effort (empty `what_to_do` on Haiku failure, never the removed venue's text — by design, Pitfall 4); a later writing pass / the UI fills it. This is defense-in-depth, not a stub.

## Threat Flags

None new. The improve dispatch is an additive action on the existing generate-plan edge fn; its only write is the existing owner-checked `update_itinerary_stops` RPC (no new write path, no new schema). All three registered threats (T-09-11 prompt injection, T-09-12 cross-owner edit, T-09-13 silent incoherence) are mitigated as planned.

## Notes for the Phase Gate (09-06)

- Visual-verify @420px is deferred to the 09-06 gate per the plan: render `/create` → generate as an authed user → confirm each stop shows a lowercase "tweak" affordance, the NL input applies a change, an incoherent swap shows a toast (not a silent swap), tokens are Barbiecore (no raw hex), taps ≥44px. Critique against DESIGN-SYSTEM.md.
- The improve dispatch needs `ANTHROPIC_HAIKU_MODEL` (defaults to `claude-haiku-4-5`) and `SUPABASE_ANON_KEY` set on the edge fn for the caller-scoped client; both are standard Supabase function env.
- Prod-apply note: NO new migration in this plan — `update_itinerary_stops` (m3 + e11) is reused as-is.

## Self-Check: PASSED

All four created files exist (improve.ts, improve.test.ts, ImproveControls.tsx, ImproveControls.test.tsx); both task commits (f0f9cf2, af6592c) are in the git log.
