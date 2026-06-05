---
phase: 08-compliant-any-city-venue-corpus
plan: 03
subsystem: database (places corpus schema + provenance)
tags: [DATA-01, DATA-02, migration, postgres, fsq_place_id, source, google_legacy, full-unique-index, sql-test]
requires:
  - phase: 08
    provides: M1 places.source check (curated/discovered/warmed) + M35 full-unique-index lesson
provides:
  - places.source check extended to accept 'foursquare' + 'google_legacy'
  - places.fsq_place_id text + FULL unique index places_fsq_place_id_key (valid ON CONFLICT arbiter)
  - cities.seeded_at timestamptz (per-city cold-start seed check)
  - one-time relabel discovered -> google_legacy (no delete)
  - SQL assertion test guarding columns + non-partial index + relabel
affects:
  - 08-04 (cold-start ON CONFLICT fsq_place_id upsert + google_legacy pool exclusion)
  - 08-05 (seed_city handler upsert + cities.seeded_at stamp)
  - 08-06 (gated prod-apply + advisor re-run)
tech-stack:
  added: []
  patterns: [name-agnostic check-constraint swap via pg_constraint content match, full-unique-index ON CONFLICT arbiter, tx-rollback SQL assertion test]
key-files:
  created:
    - supabase/migrations/20260606150000_data01_places_fsq_source.sql
    - supabase/tests/data01_places_fsq_source.sql
  modified: []
decisions:
  - "Dropped the M1 source check by content (pg_constraint def ilike '%discovered%'), not by name, since M1 created it unnamed (auto-named places_source_check on this DB) — robust to local/prod naming drift"
  - "seeded_at lives on cities (one-row cold-start check) not places (per-place scan) — per RESEARCH Open Question 2"
  - "fsq_place_id unique index is FULL (no WHERE) — re-applies the M35 lesson so ON CONFLICT (fsq_place_id) is a valid arbiter; curated rows with NULL fsq_place_id stay valid (Postgres NULLs distinct)"
  - "SQL test seeds rows in an explicit BEGIN..ROLLBACK transaction rather than a DO-block catch, because a caught exception inside a DO block does not roll back its inserts"
metrics:
  duration: ~6 min
  completed: 2026-06-05
  tasks: 2
  files_changed: 2
  tests: 1 SQL assertion passing
requirements-completed: [DATA-01, DATA-02]
---

# Phase 8 Plan 03: places Foursquare Source + Provenance Migration Summary

**A single idempotent migration adds `places.fsq_place_id` with a FULL unique index (the Foursquare upsert arbiter), `cities.seeded_at`, extends the `source` check to `foursquare`/`google_legacy`, and relabels Google-warmed `discovered` rows to `google_legacy` (no delete) — plus a tx-rollback SQL test that guards the non-partial index and the relabel.**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-06-05
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- DATA-01/DATA-02 schema landed: `fsq_place_id` + full unique index, `cities.seeded_at`, extended `source` check, and the `discovered → google_legacy` relabel — all in one idempotent migration.
- Re-applied the M35 lesson up front: the `fsq_place_id` unique index is FULL (not partial), so `ON CONFLICT (fsq_place_id)` will be a valid arbiter for the 08-04/08-05 upserts (avoids the "no unique or exclusion constraint matching the ON CONFLICT specification" failure that bit the Google path).
- SQL assertion test asserts the index is unique AND non-partial (`indpred IS NULL`), columns exist, the check admits both new values (insert-and-rollback), and the relabel flips `discovered` while leaving `curated` untouched.
- Verified local-green: `supabase db reset` replays the full chain with this migration last, no errors; the SQL test passes and leaves zero test rows behind.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the DATA-01/DATA-02 migration (idempotent)** - `ea725ff` (feat)
2. **Task 2: SQL assertion test for the migration** - `c7f2aef` (test)

## Files Created/Modified
- `supabase/migrations/20260606150000_data01_places_fsq_source.sql` - The migration: name-agnostic source-check swap → extended check; `places.fsq_place_id` + full unique index `places_fsq_place_id_key`; `cities.seeded_at`; `discovered → google_legacy` relabel. Idempotent; columns/index/relabel only, no RLS change.
- `supabase/tests/data01_places_fsq_source.sql` - psql assertion test (BEGIN..ROLLBACK): columns exist, index unique+full, source check admits the two new values, relabel preserves curated.

## Verification

- `supabase db reset` replayed the full migration chain (last migration = `20260606150000`) with no errors.
- Post-reset DB state confirmed directly: `places.fsq_place_id` present, `cities.seeded_at` present, `places_fsq_place_id_key` is `indisunique=t` and `indpred IS NULL` (full), `places_source_check` = `curated/discovered/warmed/foursquare/google_legacy`.
- `psql -v ON_ERROR_STOP=1 -f supabase/tests/data01_places_fsq_source.sql` → `data01_places_fsq_source OK`, exit 0, zero test rows persisted after rollback.
- `grep` checks from the plan's `<verification>` both satisfied: the full-index `create unique index ... places_fsq_place_id_key on public.places (fsq_place_id)` (no WHERE) and the `set source = 'google_legacy' where source = 'discovered'` relabel are present.

## Deviations from Plan

None of substance — plan executed as written. Two faithful refinements within the plan's own instructions:
- The plan suggested a guarded `do $$ ... exception when duplicate_object` block; the implementation instead locates the M1 check by content (`pg_get_constraintdef ... ilike '%discovered%'` and NOT `google_legacy`) and drops it by its discovered name, then `drop constraint if exists places_source_check` + recreate. This is the more robust form of the same instruction (the plan explicitly said "query pg_constraint for the check on places mentioning 'discovered'") and is idempotent — a re-run finds no `discovered`-only check and skips the dynamic drop.
- The SQL test uses an explicit `BEGIN; ... ROLLBACK;` transaction (not a DO-block self-rollback) because a caught exception inside a DO block does not undo that block's inserts. Net behavior matches the plan's "insert test rows in a transaction, assert, rollback."

## Notes for Downstream Plans (08-04 / 08-05 / 08-06)
- **08-04/08-05:** upsert against `places` with `onConflict: 'fsq_place_id'` — the full unique index is in place. Filter the candidate pool to exclude `source = 'google_legacy'` (e.g. `source in ('curated','foursquare')`).
- **08-05:** stamp `cities.seeded_at = now()` at the end of the `seed_city` handler.
- **08-06 (gated prod-apply):** the relabel is a NO-OP on local/CI but flips real Google-warmed rows on prod (`ufufmcpnysvwtutpbian`) — capture the before/after `source='discovered'`→`'google_legacy'` count, and re-run the Supabase security advisor after DDL (CLAUDE.md). Prod UNTOUCHED by this plan.

## Self-Check: PASSED
- FOUND: supabase/migrations/20260606150000_data01_places_fsq_source.sql
- FOUND: supabase/tests/data01_places_fsq_source.sql
- FOUND commit: ea725ff (Task 1, migration)
- FOUND commit: c7f2aef (Task 2, SQL test)
