-- supabase/tests/data01_places_fsq_source.sql
-- Regression guard for 20260606150000_data01_places_fsq_source.sql.
-- Asserts (against a freshly-reset local DB):
--   (a) places.fsq_place_id column exists
--   (b) places_fsq_place_id_key is a UNIQUE index AND is NOT partial (indpred IS NULL)
--       -- the M35 ON-CONFLICT-arbiter regression guard (Pitfall 5)
--   (c) cities.seeded_at column exists
--   (d) the source check admits 'foursquare' AND 'google_legacy' (insert-and-rollback)
--   (e) the relabel logic flips a 'discovered' row to 'google_legacy' and leaves a
--       'curated' row untouched (seed both, run the relabel, assert)
-- Self-contained: seeds test rows inside an explicit transaction that ROLLBACKs,
-- so no test rows persist. A failed assertion RAISEs and ON_ERROR_STOP aborts.
\set ON_ERROR_STOP on
BEGIN;

-- (d) seed rows with the two NEW source values -- proves the check admits them.
insert into places (name, slug, neighborhood, drive_cluster, type, source)
values ('FSQ Test',    'fsq-test-d01',    'testhood', 'testcluster', 'restaurant', 'foursquare');
insert into places (name, slug, neighborhood, drive_cluster, type, source)
values ('Legacy Test', 'legacy-test-d01', 'testhood', 'testcluster', 'restaurant', 'google_legacy');

-- (e) seed a 'discovered' + a 'curated' row for the relabel assertion.
insert into places (name, slug, neighborhood, drive_cluster, type, source)
values ('Discovered Test', 'discovered-test-d01', 'testhood', 'testcluster', 'cafe', 'discovered');
insert into places (name, slug, neighborhood, drive_cluster, type, source)
values ('Curated Test',    'curated-test-d01',    'testhood', 'testcluster', 'cafe', 'curated');

-- Re-run the migration's relabel statement (idempotent, scoped to discovered).
update places set source = 'google_legacy' where source = 'discovered';

DO $$
DECLARE
  n int;
  v_indisunique bool;
  v_is_full bool;
  v_curated_source text;
  v_discovered_source text;
BEGIN
  -- (a) places.fsq_place_id exists
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='places' and column_name='fsq_place_id';
  IF n <> 1 THEN RAISE EXCEPTION 'expected places.fsq_place_id column, found %', n; END IF;

  -- (b) places_fsq_place_id_key is unique AND full (non-partial)
  select ix.indisunique, ix.indpred is null
    into v_indisunique, v_is_full
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
   where i.relname = 'places_fsq_place_id_key';
  IF v_indisunique IS NULL THEN
    RAISE EXCEPTION 'index places_fsq_place_id_key does not exist';
  END IF;
  IF NOT v_indisunique THEN
    RAISE EXCEPTION 'places_fsq_place_id_key must be a UNIQUE index';
  END IF;
  IF NOT v_is_full THEN
    RAISE EXCEPTION 'places_fsq_place_id_key must be a FULL index (indpred IS NULL) -- a partial index is not a valid ON CONFLICT arbiter (M35 trap)';
  END IF;

  -- (c) cities.seeded_at exists
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='cities' and column_name='seeded_at';
  IF n <> 1 THEN RAISE EXCEPTION 'expected cities.seeded_at column, found %', n; END IF;

  -- (e) relabel correctness: discovered -> google_legacy, curated untouched.
  select source into v_discovered_source from places where slug = 'discovered-test-d01';
  select source into v_curated_source    from places where slug = 'curated-test-d01';
  IF v_discovered_source <> 'google_legacy' THEN
    RAISE EXCEPTION 'relabel failed: discovered row is % (expected google_legacy)', v_discovered_source;
  END IF;
  IF v_curated_source <> 'curated' THEN
    RAISE EXCEPTION 'relabel over-reached: curated row is % (expected curated)', v_curated_source;
  END IF;

  RAISE NOTICE 'data01_places_fsq_source OK';
END $$;

-- Discard all seeded test rows -- the migration itself is unaffected.
ROLLBACK;
