-- supabase/tests/p1_verification_rollup.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; v text;
BEGIN
  u := mk_user('v');
  insert into verifications (user_id, kind, state, verified_at) values (u, 'phone', 'verified', now());
  select verification::text into v from profiles where id = u;
  IF v <> 'pending' THEN RAISE EXCEPTION 'rollup wrong after phone-only: got %', v; END IF;
  insert into verifications (user_id, kind, state, verified_at) values (u, 'age', 'verified', now());
  select verification::text into v from profiles where id = u;
  IF v <> 'verified' THEN RAISE EXCEPTION 'rollup did not promote to verified: got %', v; END IF;
  update verifications set state='failed', failure_reason='id_expired' where user_id=u and kind='age';
  select verification::text into v from profiles where id = u;
  IF v <> 'failed' THEN RAISE EXCEPTION 'rollup did not demote on failure: got %', v; END IF;
  RAISE NOTICE 'verification rollup OK';
  ROLLBACK;
END $$;
