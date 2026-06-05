---
phase: 08-compliant-any-city-venue-corpus
plan: 01
subsystem: generate-plan venue corpus (edge fn)
tags: [foursquare, venue-corpus, mappers, tdd, deno]
requires: []
provides:
  - "foursquare.ts drop-in corpus source (mirrors google-places.ts surface)"
  - "fsqResultToPlaceRow / searchPlaces / geocodeCity / pickHours / mapFsqCategories / priceToTier / passesQualityFloor / buildFsqPhotoUrl"
  - "FsqResult interface + plain-object fixtures for 08-02 / 08-04"
affects:
  - "08-02 (fail-loud guards reuse nullCoords/nullHours fixtures)"
  - "08-04 (cold-start reads source='foursquare' + approval_status='auto' rows)"
  - "08-05 (seed_city handler calls searchPlaces + fsqResultToPlaceRow)"
tech-stack:
  added: []
  patterns:
    - "injectable fetchImpl: typeof fetch = fetch for key-free request-shape testing"
    - "new-API auth: Authorization: Bearer + X-Places-Api-Version: 2025-06-17"
key-files:
  created:
    - supabase/functions/generate-plan/foursquare.ts
    - supabase/functions/generate-plan/foursquare.test.ts
    - supabase/functions/generate-plan/__fixtures__/foursquare.ts
  modified: []
decisions:
  - "pickHours picks day===3 (Wednesday) else first regular entry; HHMM->HH:MM; malformed/empty -> null (never 00:00)"
  - "FSQ rating un-doubled (0-10 native); quality_score = min(10, round(rating)); quality floor rating>=7.0"
  - "approval_status pinned 'auto' (cross-plan: 08-04 read-path must admit 'auto' on every generation)"
  - "non-Kelowna city -> neighborhood=city.slug, drive_cluster='multiple' (preserve googleResultToPlaceRow behavior)"
  - "live integration test is key-gated AND permission-gated so plain `deno test` stays CI-green"
metrics:
  duration: ~3 min
  completed: 2026-06-05
  tasks: 3
  files: 3
---

# Phase 8 Plan 01: Foursquare Corpus Source Summary

Built `foursquare.ts` as a byte-shaped, license-compliant drop-in mirror of `google-places.ts`: pure field mappers, a `searchPlaces` fetch against the **new** Foursquare Places API (Bearer + version headers), and `geocodeCity` — all fixture/mock-tested with no live key, TDD-first on the silent-failure-prone `pickHours`.

## What Was Built

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | FSQ fixtures + RED tests (pickHours/category/price/floor) | 22bf206 | `__fixtures__/foursquare.ts`, `foursquare.test.ts` |
| 2 | GREEN — foursquare.ts mappers + searchPlaces | 8e558ad | `foursquare.ts` |
| 3 | searchPlaces request-shape + null-data tests | 932d0da | `foursquare.test.ts` |

**Exported surface (mirrors google-places.ts key-for-key):** `FsqResult`, `searchPlaces`, `geocodeCity`, `fsqResultToPlaceRow`, `pickHours`, `mapFsqCategories`, `priceToTier`, `passesQualityFloor`, `buildFsqPhotoUrl`, `CityForMapping`, `GeocodedCity`. Reuses `slugify` / `neighborhoodFromLatLng` / `driveClusterFromNeighborhood` by import from `google-places.ts` (no duplication).

**Pitfall guards landed (RESEARCH §Common Pitfalls):**
- P1 (hours shape): `pickHours` parses `hours.regular` per-day `{day, open:"HHMM", close:"HHMM"}`, picks Wednesday else first, `"1100"`→`"11:00"`; empty/missing/malformed → `null` (never crash, never `00:00`). Locked by 4 unit tests + null-hours mapping test.
- P2 (photo URL): `buildFsqPhotoUrl(p) = prefix + 'original' + suffix`; null when fragments absent.
- P3 (rating scale): no `×2` — `quality_score = Math.min(10, Math.round(rating))`; floor `rating >= 7.0`. Verified `grep -c 'rating * 2'` = 0.
- P5 (upsert arbiter): row carries `fsq_place_id` as the future `ON CONFLICT` key.
- P6 (auth drift): `Authorization: Bearer <key>` + `X-Places-Api-Version: 2025-06-17` asserted by the capturing-stub `fetchImpl` test.
- P7 (key-free tests): everything runs against plain-object fixtures; live test key-gated.

## Verification

- `deno test supabase/functions/generate-plan/foursquare.test.ts` → **16 passed | 0 failed** with the plain command (no `--allow-env`, no live key) — CI-runnable.
- `grep -nE "Bearer|X-Places-Api-Version" foursquare.ts` → present (new-API auth).
- `grep -c 'rating \* 2' foursquare.ts` → 0 (no Google ×2 carried over).
- TDD gate sequence in git log: `test`(RED) → `feat`(GREEN) → `test`(extension). RED was confirmed failing pre-impl ("RED confirmed").

## Cross-Plan Note (APPROVAL_STATUS)

`fsqResultToPlaceRow` pins `approval_status: 'auto'` (mirrors `google-places.ts:247`). Because the candidate read-path `filterPlaces` defaults to `['live']` and only the cold-start branch adds `'auto'`, **08-04's any-city/onthefly read-path must pass `approvalStatuses` including `'auto'` on every generation** (not just cold-start), or seeded `source='foursquare'` rows from 08-05 would be invisible to a warm-city generation. Flagged for end-to-end verification in 08-04.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Live integration test broke the plain `deno test` (no --allow-env)**
- **Found during:** Task 3
- **Issue:** `Deno.env.get('FOURSQUARE_API_KEY')` threw a permission error under the bare `deno test` command (no `--allow-env`), turning the intended-to-skip live test into a hard FAIL — violating the plan's "green with no live key" criterion.
- **Fix:** Wrapped the env read in try/catch so a denied permission skips as cleanly as an absent key.
- **Files modified:** `supabase/functions/generate-plan/foursquare.test.ts`
- **Commit:** 932d0da

**2. [Rule 3 - Blocking] Deno union-type rejected `init.headers` in the stub fetchImpl**
- **Found during:** Task 3
- **Issue:** Deno's `fetch` overload union makes `headers` not exist on the base `RequestInit`, failing type-check.
- **Fix:** Cast `init as RequestInit | undefined` before reading `headers`.
- **Files modified:** `supabase/functions/generate-plan/foursquare.test.ts`
- **Commit:** 932d0da

## Known Stubs

None. The mapper emits neutral defaults (`vibe_tags: []`, `effort: 'low'`, etc.) by design — identical to `googleResultToPlaceRow`; the LLM-augment is intentionally out of scope for the corpus source (RESEARCH "no per-place LLM augment in the stopgap").

## Threat Flags

None — no new network endpoint beyond the documented Foursquare host; key read only from `opts.apiKey`, never logged, never in returned rows. Matches the plan's threat register (T-08-01 mitigate satisfied).

## Self-Check: PASSED
