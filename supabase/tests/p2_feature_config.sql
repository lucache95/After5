-- supabase/tests/p2_feature_config.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE base timestamptz := '2026-05-25 12:00:00+00'; got timestamptz; hours numeric;
BEGIN
  PERFORM 1 FROM feature_config WHERE key='offer_window_hours';
  IF NOT FOUND THEN RAISE EXCEPTION 'feature_config offer_window_hours seed missing'; END IF;
  got := offer_expires_at(base);
  hours := extract(epoch from (got - base)) / 3600;
  IF hours < 12 OR hours > 72 THEN RAISE EXCEPTION 'offer_expires_at out of 12-72h clamp: %', hours; END IF;
  RAISE NOTICE 'feature_config OK (% hours)', hours;
END $$;
