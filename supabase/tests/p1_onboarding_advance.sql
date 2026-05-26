-- supabase/tests/p1_onboarding_advance.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; step text; ts timestamptz; bad boolean := false;
BEGIN
  u := mk_user('ob');
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u::text)::text, true);
  perform advance_onboarding_step('basics');
  perform advance_onboarding_step('photos');
  perform advance_onboarding_step('preferences');
  perform advance_onboarding_step('phone_verify');
  perform advance_onboarding_step('selfie_verify');
  perform advance_onboarding_step('done');
  select onboarding_step, onboarding_completed_at into step, ts from profiles where id = u;
  IF step <> 'done' THEN RAISE EXCEPTION 'onboarding did not reach done: got %', step; END IF;
  IF ts IS NULL THEN RAISE EXCEPTION 'onboarding_completed_at not stamped at done'; END IF;
  BEGIN
    perform advance_onboarding_step('basics');
  EXCEPTION WHEN others THEN bad := true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'onboarding allowed a backward step'; END IF;
  RAISE NOTICE 'onboarding advance OK';
  ROLLBACK;
END $$;
