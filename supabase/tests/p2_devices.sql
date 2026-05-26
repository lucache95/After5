-- supabase/tests/p2_devices.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; n int;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='devices' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'devices missing or RLS off'; END IF;
  -- C11.2 columns
  PERFORM 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='expo_push_token';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices.expo_push_token missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='web_push_sub';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices.web_push_sub missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='id';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices surrogate id missing'; END IF;
  -- nulls-not-distinct unique constraint exists
  PERFORM 1 FROM pg_indexes WHERE tablename='devices'
    AND indexdef ILIKE '%user_id%expo_push_token%';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices (user_id, expo_push_token) unique missing'; END IF;

  -- register_device upserts (same user+token twice => one row)
  u := mk_user('dev');
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  PERFORM register_device('ExponentPushToken[x]','ios', null);
  PERFORM register_device('ExponentPushToken[x]','ios', null);
  SELECT count(*) INTO n FROM devices WHERE user_id=u;
  IF n <> 1 THEN RAISE EXCEPTION 'register_device not idempotent: % rows', n; END IF;
  RAISE NOTICE 'devices OK';
  ROLLBACK;
END $$;
