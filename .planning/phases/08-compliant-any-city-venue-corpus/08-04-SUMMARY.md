---
phase: 08-compliant-any-city-venue-corpus
plan: 04
subsystem: generate-plan (cold-start provider re-sourcing)
tags: [DATA-01, DATA-02, foursquare, onthefly, city_warming, google_legacy, deno, tdd]

requires:
  - phase: 08
    provides: "foursquare.ts (searchPlaces/fsqResultToPlaceRow/passesQualityFloor, source='foursquare'+approval_status='auto') [08-01]; places.fsq_place_id FULL unique index + source check + discovered→google_legacy relabel [08-03]; fail-loud filterPlaces guards [08-02]"
provides:
  - "OnTheFlyProvider re-sourced to Foursquare (no Google import in the generation path)"
  - "cold-start upsert onConflict 'fsq_place_id'; env.foursquareKey guard (503 when unset)"
  - "filterPlaces excludes source='google_legacy' from the candidate pool (the compliance point)"
  - "any-city read-path passes approvalStatuses ['live','auto'] on EVERY generation (W3) + admitsRow predicate"
  - "distinct city_warming (503) fallback for a still-thin warmed city (never a garbage date)"
  - "PipelineError extracted to pipeline-error.ts (SDK-chain-free import)"
affects:
  - "08-05 (seed_city handler reuses searchPlaces + fsqResultToPlaceRow + onConflict fsq_place_id; warmed 'auto' rows now admitted by warm-city generations)"
  - "08-06 (gated prod-apply + live smoke: verify the FSQ_SEED_CATEGORY_IDS against the live taxonomy; re-run the railway/select SDK-gated tests under node_modules)"

tech-stack:
  added: []
  patterns:
    - "injectable provider deps (OnTheFlyDeps: searchPlaces + runPipeline) so generate() is unit-testable without a live key"
    - "lazy `await import('./pipeline.ts')` in the production provider + PipelineError moved to its own module → unit tests dodge the prompt.ts→@anthropic-ai/sdk chain (same dodge 08-02 used for computeUnverifiedRate)"
    - "pure read-path predicate (admitsRow) mirroring the supabase select clauses for unit coverage of source/approval_status admission"

key-files:
  created:
    - supabase/functions/generate-plan/providers/pipeline-error.ts
  modified:
    - supabase/functions/generate-plan/providers/onthefly.ts
    - supabase/functions/generate-plan/providers/onthefly.test.ts
    - supabase/functions/generate-plan/providers/types.ts
    - supabase/functions/generate-plan/providers/pipeline.ts
    - supabase/functions/generate-plan/places-filter.ts
    - supabase/functions/generate-plan/places-filter.test.ts

key-decisions:
  - "city_warming translation only fires when the city WAS cold-warmed this request — an already-warm city's no_candidates stays 422 (genuine filter miss, not a warming state)"
  - "FSQ_SEED_CATEGORY_IDS kept as a fixed server-side constant (4 top-level ids), not user input — threat-model SQL-injection / unbounded-seed control"
  - "PipelineError extracted to pipeline-error.ts (pipeline.ts re-exports) so onthefly.test.ts imports the error without the Anthropic-SDK chain; production runPipeline imported lazily"
  - "approvalStatuses ['live','auto'] exported as ONTHEFLY_APPROVAL_STATUSES from places-filter.ts and passed on EVERY generation (W3), not just the inline-warm branch"

patterns-established:
  - "Provider dependency injection: control-flow (env guard / cold-check / warm / city_warming) tested via mocked searchPlaces+runPipeline, no network/key"
  - "Distinct degradation signal: thin warmed city → city_warming(503), surfaced through the handler's generic PipelineError code/status passthrough — no handler change needed"

requirements-completed: [DATA-01, DATA-02]

duration: 5min
completed: 2026-06-05
---

# Phase 8 Plan 04: Foursquare Cold-Start Re-sourcing + city_warming Fallback Summary

**OnTheFlyProvider now warms cold cities from the compliant Foursquare corpus (upsert onConflict `fsq_place_id`, `env.foursquareKey` guard), excludes relabeled `google_legacy` rows from the LLM pool, admits `approval_status='auto'` rows on every generation (W3), and degrades a still-thin city to a distinct `city_warming` (503) instead of a garbage date.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-05T22:51:10Z
- **Completed:** 2026-06-05T22:55:57Z
- **Tasks:** 3 (TDD)
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments
- **DATA-01:** `OnTheFlyProvider` re-sourced to `foursquare.ts` — `searchPlaces`/`fsqResultToPlaceRow`/`passesQualityFloor` replace the Google import; cold-start upserts `onConflict: 'fsq_place_id'`; reads `env.foursquareKey` (503 `generation_unavailable` when unset). No `google-places`/`googleResultToPlaceRow`/`env.googleKey` remains in the generation path.
- **Area 2 (compliance point):** `filterPlaces` adds `.neq('source', 'google_legacy')` so relabeled Google content can never reach the LLM.
- **W3 (APPROVAL_STATUS):** the any-city read-path passes `['live','auto']` on **every** generation (exported `ONTHEFLY_APPROVAL_STATUSES`), so a background-seeded city's `source='foursquare', approval_status='auto'` rows (08-01/08-05) are admitted even on a non-cold-start generation.
- **DATA-02:** a city still thin after the inline warm throws `PipelineError('city_warming', …, 503)` — a distinct "warming up — check back in a moment" signal, never the generic `no_candidates` (422) and never a broken itinerary.

## Task Commits

Each task TDD'd (RED test → GREEN impl):

1. **Task 1: foursquareKey env + google_legacy pool exclusion + W3 read-path** — `94ff6ee` (test) → `34d4861` (feat)
2. **Task 2: re-source OnTheFlyProvider to Foursquare** — `8cf1387` (test) → `e994b7f` (feat)
3. **Task 3: city_warming fallback for a still-thin city** — `83bd661` (test) _(translation logic shipped with Task 2's feat, where it is intrinsic to the same generate() flow; Task 3 adds the behavioral tests)_

## Files Created/Modified
- `providers/onthefly.ts` — re-sourced to Foursquare: `buildWarmRows` (dedupe-by-`fsq_place_id` + `passesQualityFloor`), fixed `FSQ_SEED_CATEGORY_IDS` (4 top-level ids), `generateOnTheFly(ctx, deps)` injectable seam, env guard, cold-check, upsert `onConflict 'fsq_place_id'`, `runPipeline(['live','auto'])`, `city_warming` translation.
- `providers/onthefly.test.ts` — rewritten for FSQ: buildWarmRows floor/dedupe, env-guard, warm-skip, cold-warm-runs-[live,auto], and the three city_warming cases (thin→503, warm-no_candidates stays 422, healthy returns itineraries). Imports `PipelineError` from `pipeline-error.ts`, no node_modules needed.
- `providers/pipeline-error.ts` — **new.** Holds `PipelineError` so importers needing only the typed error skip the `prompt.ts → @anthropic-ai/sdk` chain.
- `providers/pipeline.ts` — `PipelineError` moved out; re-exports it (existing `import … from './pipeline.ts'` callers unchanged).
- `providers/types.ts` — `GenerationEnv.foursquareKey?: string`.
- `places-filter.ts` — `.neq('source', 'google_legacy')` on the select; exported `admitsRow` predicate + `ONTHEFLY_APPROVAL_STATUSES`.
- `places-filter.test.ts` — admitsRow excludes google_legacy, admits foursquare/auto (Area 2 + W3).

## Decisions Made
- See `key-decisions` frontmatter. Headline: `city_warming` is gated on `wasCold` so it never masks a real filter miss in an already-warm city; FSQ category ids are a fixed server-side constant; `PipelineError` extraction keeps unit tests SDK-free.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `PipelineError` import dragged the Anthropic-SDK chain into the unit test**
- **Found during:** Task 2
- **Issue:** `onthefly.test.ts` needs `PipelineError`, which lived in `pipeline.ts`; importing `pipeline.ts` (or `onthefly.ts` while it imported `runPipeline` from it) transitively pulls `prompt.ts → npm:@anthropic-ai/sdk@^0.40.0`, unresolvable under plain `deno test` (no node_modules) — the same gap 08-02 hit.
- **Fix:** Extracted `PipelineError` to `providers/pipeline-error.ts` (pipeline.ts re-exports it); made `OnTheFlyProvider.generate` import the real `runPipeline` lazily (`await import('./pipeline.ts')`) so the module top level stays SDK-free and tests inject `runPipeline` via `OnTheFlyDeps`.
- **Files modified:** `providers/pipeline-error.ts` (new), `providers/pipeline.ts`, `providers/onthefly.ts`, `providers/onthefly.test.ts`
- **Verification:** `onthefly.test.ts` now runs with `--no-check` AND resolves all imports without node_modules; 9 passed.
- **Committed in:** `e994b7f` (Task 2 feat)

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** improved test isolation (onthefly tests no longer require node_modules); no scope creep — pure import-graph plumbing the plan's "if a pre-existing npm-SDK gap forces --no-check, that's acceptable" note anticipated.

## Issues Encountered

**Pre-existing npm-SDK type-resolution gap (out of scope, deferred to 08-06).** Type-checking (`deno test` without `--no-check`) and two sibling provider test files (`railway.test.ts`, `select.test.ts`) still fail because they import `pipeline.ts`/`select.ts` → `prompt.ts → npm:@anthropic-ai/sdk` with no local `node_modules`. This is the documented 08-02 environment gap — `railway.ts` imports `PipelineError from './pipeline.ts'` identically at HEAD before this plan, so it is unchanged/unregressed by 08-04. All 08-04 behavior verified at the behavior level via `--no-check` (28 passed across onthefly + places-filter + foursquare). The local-suite-green + type-check gate is owned by 08-06 (which runs under node_modules). Logged for that gate.

## Verification
- `deno test --allow-all --no-check` over `onthefly.test.ts` + `places-filter.test.ts` + `foursquare.test.ts` → **28 passed | 0 failed**.
- `grep "google-places|googleResultToPlaceRow|env.googleKey" onthefly.ts` → **none** (Google import gone from the generation path).
- `grep "city_warming|onConflict: 'fsq_place_id'|env.foursquareKey" onthefly.ts` → all present (8 hits).
- `grep "neq('source', 'google_legacy')" places-filter.ts` → present.
- Handler (`index.ts:178`) forwards `PipelineError.code`/`.httpStatus` generically, so `city_warming`/503 reaches the client as a distinct error code with no handler change (Rule 2 check — no missing wiring).

## Threat Model Compliance
- **T-08-08 (DoS):** `COLD_THRESHOLD` skips re-fetching warm cities; bounded 4-category set with per-category `limit: 30`; `city_warming` short-circuits instead of hanging — satisfied.
- **T-08-09 (key disclosure):** `env.foursquareKey` read from edge env only; never in the `city_warming` message (asserted by test) nor in returned rows — satisfied.
- **T-08-10 (google_legacy in pool):** `filterPlaces.neq('source','google_legacy')` excludes Google content from the LLM feed — satisfied.

## Known Stubs
None. `FSQ_SEED_CATEGORY_IDS` are `[ASSUMED]` long-standing top-level ids (RESEARCH A1) flagged for re-verification at the 08-06 live smoke — not a stub (real ids, used now), just an open verification item.

## Next Phase Readiness
- 08-05 (`seed_city`) can reuse `searchPlaces` + `fsqResultToPlaceRow` + `onConflict 'fsq_place_id'`; its background-warmed `auto` rows are now admitted by warm-city generations (W3 closed).
- 08-06 must: (1) re-verify the four FSQ top-level category ids against the live taxonomy before/at prod smoke; (2) run the full suite under node_modules to clear the SDK-gated `railway`/`select` type-checks; (3) the gated prod-apply (08-03 relabel) + advisor re-run remain owned there.

## Self-Check: PASSED
- FOUND: `.planning/phases/08-compliant-any-city-venue-corpus/08-04-SUMMARY.md`
- FOUND: `supabase/functions/generate-plan/providers/pipeline-error.ts`, `providers/onthefly.ts`
- FOUND commits: 94ff6ee, 34d4861 (T1) · 8cf1387, e994b7f (T2) · 83bd661 (T3)

---
*Phase: 08-compliant-any-city-venue-corpus*
*Completed: 2026-06-05*
