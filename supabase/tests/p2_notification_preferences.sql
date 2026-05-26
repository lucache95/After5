-- supabase/tests/p2_notification_preferences.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='notification_preferences' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'notification_preferences missing or RLS off'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='notification_preferences' AND column_name='quiet_hours_start';
  IF NOT FOUND THEN RAISE EXCEPTION 'quiet_hours_start missing'; END IF;
END $$;
