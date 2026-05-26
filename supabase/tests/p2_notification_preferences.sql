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

-- The AFTER INSERT trigger on profiles must auto-create a prefs row (dispatch hygiene).
DO $$
DECLARE u uuid; pe boolean;
BEGIN
  u := mk_user('pref');
  SELECT push_enabled INTO pe FROM notification_preferences WHERE user_id = u;
  IF NOT FOUND THEN RAISE EXCEPTION 'profiles_ensure_notif_prefs trigger did not auto-create a row'; END IF;
  IF pe IS NOT TRUE THEN RAISE EXCEPTION 'default push_enabled should be true'; END IF;
  RAISE NOTICE 'notification_preferences auto-create trigger OK';
  ROLLBACK;
END $$;
