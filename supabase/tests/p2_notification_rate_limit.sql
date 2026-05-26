-- supabase/tests/p2_notification_rate_limit.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid := gen_random_uuid(); r json; allowed boolean; i int;
BEGIN
  FOR i IN 1..30 LOOP r := notification_rate_check(u, 'new_message'); END LOOP;
  r := notification_rate_check(u, 'new_message');
  allowed := (r->>'allowed')::boolean;
  IF allowed THEN RAISE EXCEPTION 'new_message should be rate-limited after burst'; END IF;

  FOR i IN 1..100 LOOP r := notification_rate_check(u, 'safety_checkin'); END LOOP;
  allowed := (r->>'allowed')::boolean;
  IF NOT allowed THEN RAISE EXCEPTION 'safety_checkin must never be rate-limited'; END IF;

  FOR i IN 1..100 LOOP r := notification_rate_check(u, 'safety_alert'); END LOOP;
  allowed := (r->>'allowed')::boolean;
  IF NOT allowed THEN RAISE EXCEPTION 'safety_alert must never be rate-limited'; END IF;
  RAISE NOTICE 'notification rate-limit OK';
  ROLLBACK;
END $$;
