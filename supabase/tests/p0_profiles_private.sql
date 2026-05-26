-- supabase/tests/p0_profiles_private.sql
-- Verifies the table exists, RLS is enabled, and the C11.13 birthdate write-lock holds.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; ok boolean := false;
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='profiles' AND column_name='dating_enabled';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.dating_enabled missing'; END IF;
  PERFORM 1 FROM pg_tables WHERE tablename='profiles_private' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles_private missing or RLS off'; END IF;

  -- C11.13: the authenticated owner must NOT be able to write birthdate (age-gate source of
  -- truth; only the service-role Persona webhook writes it). Become the owner and prove the
  -- birthdate write is denied at the privilege layer.
  u := mk_user('c1113');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  EXECUTE 'set local role authenticated';
  BEGIN
    INSERT INTO profiles_private (user_id, birthdate) VALUES (u, date '1990-01-01');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  EXECUTE 'reset role';
  IF NOT ok THEN RAISE EXCEPTION 'C11.13 FAILED: authenticated wrote profiles_private.birthdate'; END IF;
  RAISE NOTICE 'C11.13 birthdate write-lock OK';
  ROLLBACK;
END $$;
