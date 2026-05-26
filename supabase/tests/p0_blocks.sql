-- supabase/tests/p0_blocks.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='blocks' AND indexdef ILIKE '%unique%blocker_id%blocked_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'blocks unique(blocker,blocked) missing'; END IF;
END $$;
