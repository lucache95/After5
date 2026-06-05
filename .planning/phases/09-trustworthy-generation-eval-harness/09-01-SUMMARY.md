---
phase: 09-trustworthy-generation-eval-harness
plan: 01
subsystem: generate-plan edge function (copy pass + slot scoring)
tags: [plan-01, tool-use, haversine, hop-gate, anthropic, scoring]
requires:
  - "@anthropic-ai/sdk@0.40.1 (in-tree; edge pins npm:@anthropic-ai/sdk@^0.40.0)"
  - "haversineKm (places-filter.ts) — now exported"
provides:
  - "tool-use forced copy pass (ITINERARY_TOOL + extractToolUseItineraries)"
  - "withinHop + MAX_HOP_KM haversine adjacency gate"
  - "post-validate + repair of far consecutive hops in buildItineraryFromTemplate"
  - "exported haversineKm"
affects:
  - supabase/functions/generate-plan/prompt.ts
  - supabase/functions/generate-plan/scoring.ts
  - supabase/functions/generate-plan/places-filter.ts
tech-stack:
  added: []
  patterns:
    - "Anthropic forced tool_choice for structured output (replaces fence-strip + JSON.parse)"
    - "haversine consecutive-hop gate with DATA-03 fail-loud null-coord exclusion"
    - "pre-filter (soft penalty) + post-validate + repair for proximity coherence"
key-files:
  created: []
  modified:
    - supabase/functions/generate-plan/prompt.ts
    - supabase/functions/generate-plan/prompt.test.ts
    - supabase/functions/generate-plan/scoring.ts
    - supabase/functions/generate-plan/scoring.test.ts
    - supabase/functions/generate-plan/places-filter.ts
    - supabase/functions/generate-plan/places-filter.test.ts
decisions:
  - "MAX_HOP_KM = 2.0 (walkable / short drive); no per-stop-type weighting (kept simple, CONTEXT discretion)"
  - "Hop-gate is a SOFT penalty in the pick loop + a HARD post-validate+repair on the assembled plan (Open Question 1 → GENERATION.md recommendation), preserving plan availability on thin pools"
  - "estimateDriveMin now uses real haversine distance when coords exist so the displayed drive time agrees with the gate; drive_cluster heuristic is the coords-unknown fallback only"
  - "tool input_schema field names kept byte-identical to LLMItineraryWriting (Pitfall 3) so mergeWriting/patchEmptyStops are untouched"
metrics:
  duration: ~5 min
  completed: 2026-06-05
---

# Phase 9 Plan 01: Trustworthy Generation Hardening (Tool-Use + Haversine Hop-Gate) Summary

Migrated the Sonnet copy pass to a forced Anthropic tool call and replaced the `drive_cluster` string adjacency gate with a real haversine consecutive-hop gate (`withinHop`/`MAX_HOP_KM`) plus post-validate-and-repair — the deterministic "LLM never picks places" invariant is preserved.

## What Was Built

### Task 1 — Tool-use copy pass (commit dc97810)
- Replaced `parseLLMResponse` (fence-strip + `JSON.parse` + array-check) with a forced `tool_choice: { type: 'tool', name: 'emit_itineraries' }` call against the in-tree `@anthropic-ai/sdk@0.40.1`.
- Added exported `ITINERARY_TOOL` (schema field names byte-identical to `LLMItineraryWriting`) and exported pure `extractToolUseItineraries(response)`, which pulls `input.itineraries` from the `tool_use` block and returns `[]` when no block / malformed input is present — keeping the deterministic fallback path alive (T-09-03).
- Kept `mergeWriting`, `patchEmptyStops`, `buildFallbackWhatToDo`, the ephemeral `cache_control` system prompt, and the empty-`what_to_do` defense-in-depth fallback.
- Trimmed the now-stale "return ONLY a JSON array / no markdown fences" instructions in the system + user prompt to the tool-call contract.

### Task 2 — Haversine hop-gate (commit b0476df)
- Exported `haversineKm` from `places-filter.ts` (was module-private) so the gate reuses one geo-math source of truth.
- Added `MAX_HOP_KM = 2.0` and `withinHop(prev, cand, maxKm)`: true within hop, false beyond, **false on null coords** (DATA-03 fail-loud, mirrors `withinRadius`), true for the first stop (`prev === undefined`).
- Removed `clusterCompatible`; the pick loop now applies a soft `-5` penalty when a candidate is a far hop from the previous consecutive stop.
- Added `repairFarHops`: after assembly, any consecutive hop exceeding `MAX_HOP_KM` is repaired by swapping the far stop for the nearest in-slot candidate within hop (not already used). If the pool can't repair, the original pick is kept (availability over failure).
- `estimateDriveMin` now derives the displayed drive time from real distance when coords exist (agrees with the gate); the `drive_cluster` heuristic remains only for coords-unknown display.

## Verification

- `deno test prompt.test.ts` — 6/6 green (tool schema shape, tool_use extraction, fallback paths).
- `deno test scoring.test.ts places-filter.test.ts` — 16/16 green (withinHop near/far/null/first-stop, repair swap, haversineKm export).
- Full `generate-plan` deno suite — **67 passed / 0 failed**.
- `parseLLMResponse` and `clusterCompatible` confirmed removed (grep, 0 refs); `tool_choice`, `MAX_HOP_KM`, `withinHop`, `export function haversineKm` all present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] deno could not resolve `npm:@anthropic-ai/sdk@^0.40.0` under the test runner**
- **Found during:** Task 1 (RED run)
- **Issue:** `prompt.ts` top-level imports the Deno `npm:` specifier; `deno test` failed with "Could not find a matching package … in the node_modules directory" before any test ran. This is the pre-existing SDK import gap the plan's key_notes flagged.
- **Fix:** Run the deno tests with `--no-check --node-modules-dir=auto`, which resolves the SDK from the existing root `node_modules`. No source change needed; the SDK import itself is correct for the edge (Deno) runtime. `extractToolUseItineraries` was also written against a minimal structural response type (not the SDK's `ContentBlock`) so the tool-use logic is unit-testable without importing SDK types.
- **Commit:** dc97810
- **Note for downstream plans:** the canonical local test command for this function dir is `deno test <files> --allow-env --allow-read --no-check --node-modules-dir=auto`.

**2. [Rule 1 - Test correctness] repair test assumed deterministic slot-1 pick**
- **Found during:** Task 2 (first GREEN run)
- **Issue:** The initial two-slot repair test used `cafe` for both slots; `pickFromTop` is a top-K weighted-random pick, so slot 1 was not deterministically the anchor and the assertion flaked.
- **Fix:** Made slot 1 a distinct type (`restaurant`) with a single candidate so the anchor is deterministic, and added an end-to-end assertion that every consecutive hop in the assembled plan is ≤ `MAX_HOP_KM`.
- **Commit:** b0476df

## Known Stubs

None. No placeholder/empty-data patterns introduced; the copy fallback chain (`mergeWriting` → `patchEmptyStops` → `buildFallbackWhatToDo`) is intentional defense-in-depth, not a stub.

## Notes for the Phase Gate

- The eval harness (Plan 09-03) re-runs against this hardened pick logic. The `unverified_rate` first-class signal (Pitfall 1) is 09-03's responsibility — the gate here already excludes null-coord stops (fail-loud), so a cold city surfaces far/unverifiable hops rather than passing vacuously.
- `drive_cluster` column is intentionally retained for display/back-compat; do not drop it.

## Self-Check: PASSED

All modified files exist; both task commits (dc97810, b0476df) are in the git log.
