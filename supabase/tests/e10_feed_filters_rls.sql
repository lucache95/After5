-- supabase/tests/e10_feed_filters_rls.sql
-- E10 (REQ-E10): profiles.feed_filters is self-write only, via the existing
-- profiles_owner_all policy (USING/WITH CHECK id=auth.uid()). NO new policy is added;
-- this test proves the jsonb column inherits the row policy: user A cannot write
-- user B's feed_filters (0 rows affected), and self-write succeeds.
--
-- Mirrors p1_preferences.sql (\i _fixtures.sql, authenticated role, ROLLBACK).
-- RED until 20260605120400_e10_feed_filters_column.sql lands (column absent).
\i supabase/tests/_fixtures.sql

DO $$
DECLARE a uuid; b uuid; affected int; b_filters jsonb; a_filters jsonb;
BEGIN
  a := mk_user('e10_rls_a');
  b := mk_user('e10_rls_b');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);

  -- A tries to write B's feed_filters -> RLS WITH CHECK / USING blocks it (0 rows)
  update profiles set feed_filters='{"max_price":1}'::jsonb where id = b;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'E10.RLS: user A must NOT write user B feed_filters (rows affected=%)', affected;
  END IF;

  -- A writes A's own feed_filters -> succeeds
  update profiles set feed_filters='{"max_distance_km":25,"vibes":["cozy"]}'::jsonb where id = a;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'E10.RLS: self-write of feed_filters should affect exactly 1 row (got %)', affected;
  END IF;

  reset role;

  -- confirm B is untouched and A persisted (read with elevated role)
  select feed_filters into b_filters from profiles where id=b;
  IF b_filters <> '{}'::jsonb THEN
    RAISE EXCEPTION 'E10.RLS: B feed_filters should remain the default empty object (got %)', b_filters;
  END IF;
  select feed_filters into a_filters from profiles where id=a;
  IF a_filters ->> 'max_distance_km' IS DISTINCT FROM '25' THEN
    RAISE EXCEPTION 'E10.RLS: A self-write did not persist (got %)', a_filters;
  END IF;

  RAISE NOTICE 'E10.RLS: feed_filters self-write only OK';
  ROLLBACK;
END $$;
