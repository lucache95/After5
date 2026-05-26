-- supabase/tests/p2_admin_alerts.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE a uuid; n int;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='admin_alerts' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_alerts missing or RLS off'; END IF;
  a := raise_admin_alert('safety_no_device', '{"user_id":"x","type":"safety_checkin"}'::jsonb);
  SELECT count(*) INTO n FROM admin_alerts WHERE id=a AND kind='safety_no_device' AND resolved_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'raise_admin_alert did not insert open alert'; END IF;
  RAISE NOTICE 'admin_alerts OK';
  ROLLBACK;
END $$;
