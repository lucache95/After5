-- supabase/tests/p0_profiles_private.sql
-- Verifies the table exists and RLS is enabled (policy behavior is exercised by app integration tests).
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='profiles' AND column_name='dating_enabled';
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles.dating_enabled missing'; END IF;
  PERFORM 1 FROM pg_tables WHERE tablename='profiles_private' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles_private missing or RLS off'; END IF;
END $$;
