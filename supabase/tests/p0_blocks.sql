-- supabase/tests/p0_blocks.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; ok boolean := false;
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='blocks' AND indexdef ILIKE '%unique%blocker_id%blocked_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'blocks unique(blocker,blocked) missing'; END IF;

  -- Behavior: the CHECK (blocker_id <> blocked_id) must reject self-blocks. Run as postgres
  -- (RLS bypassed), so this exercises the table CHECK constraint, not the RLS policy.
  u := mk_user('blk');
  BEGIN
    insert into blocks (blocker_id, blocked_id) values (u, u);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'CHECK FAILED: self-block (blocker=blocked) was allowed'; END IF;
  RAISE NOTICE 'blocks structural + self-block CHECK OK';
  ROLLBACK;
END $$;
