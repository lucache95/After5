-- supabase/tests/p0_date_instances.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; itin uuid; inst uuid; rng tstzrange;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='date_instances' AND column_name='time_range';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances.time_range missing'; END IF;

  -- Value check: the generated time_range (via the IMMUTABLE wrapper) must span exactly
  -- [starts_at, starts_at + duration_min). Guards the PG17 generated-column workaround.
  u    := mk_user('range');
  itin := mk_itinerary(u);
  inst := mk_instance(itin, u, timestamptz '2026-06-01 19:00Z');  -- duration default 150
  SELECT time_range INTO rng FROM date_instances WHERE id = inst;
  IF lower(rng) <> timestamptz '2026-06-01 19:00Z'
     OR upper(rng) <> timestamptz '2026-06-01 21:30Z'
     OR (upper(rng) - lower(rng)) <> interval '150 minutes'
  THEN RAISE EXCEPTION 'time_range wrong: %', rng; END IF;
  RAISE NOTICE 'date_instances.time_range OK: %', rng;
  ROLLBACK;
END $$;
