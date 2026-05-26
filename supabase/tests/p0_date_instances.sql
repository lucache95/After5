-- supabase/tests/p0_date_instances.sql
DO $$
DECLARE r tstzrange;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='date_instances' AND column_name='time_range';
  IF NOT FOUND THEN RAISE EXCEPTION 'date_instances.time_range missing'; END IF;
END $$;
