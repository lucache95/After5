---
phase: 03-marketplace-completeness-p1
plan: 01
subsystem: database-foundation
tags: [migration, enum, rpc, targeting, definer, security]
requires: []
provides:
  - "date_instances.target_genders / target_age_range / search_radius_km (numeric) columns"
  - "queue_status.passed_by_host enum value (own migration, pre-consumer)"
  - "post_night extended with p_target_genders/p_target_age_range/p_search_radius_km (one live 8-arg signature)"
  - "update_itinerary_stops extended with p_pay_setting/p_vibe_tags (one live 7-arg signature)"
  - "postNight + updateItineraryStops api-client wrappers carry the new params"
affects:
  - "03-02 reject_candidate (consumes passed_by_host)"
  - "Phase 4 E10 feed targeting/filter layer (consumes target_* columns)"
  - "InterestedList UI (later Phase-3 plan; status union now includes passed_by_host)"
tech-stack:
  added: []
  patterns: [additive-column, additive-enum-own-migration, rpc-overload-drop, anon-revoke-on-reemit]
key-files:
  created:
    - supabase/migrations/20260605120000_e11_targeting_cols.sql
    - supabase/migrations/20260605120100_e12_queue_status_passed_by_host.sql
    - supabase/migrations/20260605120200_e11_post_night_targeting.sql
    - supabase/tests/e11_targeting.sql
  modified:
    - packages/api-client/src/feed.ts
    - packages/types/src/database.ts
    - apps/web/app/dates/[slug]/interested/InterestedList.tsx
    - supabase/tests/m3_update_itinerary_stops.sql
    - supabase/tests/m4_post_night_ambient.sql
decisions:
  - "search_radius_km typed numeric (not int) to match Phase 4 REQ-E10 and avoid a later ALTER COLUMN"
  - "passed_by_host lives in its own migration sequenced before any consumer (PG ADD VALUE same-tx rule)"
  - "Dropped the prior 5-arg overloads on both RPCs so exactly one live signature remains (avoids PGRST203)"
  - "Targeting written to the date_instances insert only; the itinerary fork select left untouched (Pitfall 4)"
metrics:
  duration: ~7m
  completed: 2026-06-04
---

# Phase 3 Plan 01: Foundation Migrations Summary

Three LOCAL-only additive migrations plus two RPC extensions lay the Phase-3 DB seam: per-date targeting columns on `date_instances`, the `passed_by_host` `queue_status` value, and the extended `post_night` (targeting) / `update_itinerary_stops` (pay/vibe) signatures — full local chain green, prod apply gated.

## What Was Built

- **Targeting columns** (`20260605120000_e11_targeting_cols.sql`): `target_genders text[] not null default '{}'`, `target_age_range int4range` (nullable), `search_radius_km numeric` (nullable) on `date_instances`. Additive, idempotent, safe defaults so existing rows stay valid with zero backfill. No RLS change (row policies already cover new columns).
- **Enum value** (`20260605120100_e12_queue_status_passed_by_host.sql`): `alter type queue_status add value if not exists 'passed_by_host'` — its OWN migration, sequenced before the 03-02 `reject_candidate` consumer (PG ADD-VALUE same-tx rule).
- **RPC extensions** (`20260605120200_e11_post_night_targeting.sql`):
  - `update_itinerary_stops` gains `p_pay_setting text` + `p_vibe_tags text[]` coalesce setters (pay_setting cast to `payment_preference`). Prior 5-arg overload dropped; one live 7-arg signature; grant trio re-emitted with anon revoked.
  - `post_night` gains `p_target_genders text[]` + `p_target_age_range int4range` + `p_search_radius_km numeric`, written into the `date_instances` insert (fork select untouched). Prior 5-arg overload dropped; one live 8-arg signature; grant trio re-emitted.
- **Wrappers** (`packages/api-client/src/feed.ts`): `postNight` + `updateItineraryStops` pass the new optional params (defaulted, so existing callers compile unchanged).
- **SQL test** (`e11_targeting.sql`): 6 assertions — targeting persistence, targeting defaults, pay/vibe setters, `passed_by_host` validity, anon-revoke on both signatures, one-live-signature-per-function.

## Verification

- `pnpm db:reset` — full chain applied clean from scratch (incl. all 3 new migrations).
- `pnpm db:types` — regenerated `database.ts`; `target_genders`/`target_age_range`/`search_radius_km`/`passed_by_host` present (14 grep matches).
- `pnpm db:test` — full SQL suite GREEN (exit 0), incl. `e11_targeting.sql` (all 6 NOTICEs).
- `pnpm typecheck` — GREEN (6/6 tasks).
- Security grep-audit: both new functions `security definer set search_path`; `revoke ... from anon` on both signatures; NO `using(true)` introduced in any new migration.
- **No prod apply / db:push / edge deploy performed** (gated).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Sibling SQL tests broke on the overload drop**
- **Found during:** Task 3 (`pnpm db:test`).
- **Issue:** Dropping the prior 5-arg `update_itinerary_stops` and 5-arg `post_night` overloads (Task 2) broke `m3_update_itinerary_stops.sql` (called the 5-arg signature + checked the 5-arg privilege) and `m4_post_night_ambient.sql` (asserted `pronargs=5`).
- **Fix:** Updated the three `update_itinerary_stops` call sites to 7 positional args, the privilege check to the 7-arg signature, and the `post_night` `pronargs` assertion to 8.
- **Files modified:** `supabase/tests/m3_update_itinerary_stops.sql`, `supabase/tests/m4_post_night_ambient.sql`.
- **Commit:** 0739baa

**2. [Rule 3 - Blocking] `HostCandidate` status union excluded the new enum member**
- **Found during:** Task 3 (`pnpm typecheck`).
- **Issue:** Regenerated `database.ts` widened the `queue_status` enum; `InterestedList.tsx`'s hand-typed `HostCandidate['status']` union no longer matched the DB row type (TS2345/TS2322 in `InterestedList.tsx` + `interested/page.tsx`).
- **Fix:** Added `'passed_by_host'` to the union (type seam only — no filtering/UI; the reject/silent-removal UI lands in a later Phase-3 plan, as PATTERNS §103 anticipates).
- **Files modified:** `apps/web/app/dates/[slug]/interested/InterestedList.tsx`.
- **Commit:** 0739baa

## Threat Flags

None. New surface matches the plan's threat register: both re-emitted DEFINER signatures revoke anon (T-03-01), targeting written to the date_instances insert only (T-03-02), single live signature per function (T-03-03), enum added in its own migration (T-03-04).

## Self-Check: PASSED
