-- supabase/tests/p0_offer_invariant.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE inst uuid; cre uuid; a uuid; b uuid; itin uuid; ok boolean := false;
BEGIN
  -- C8 fixtures: mk_user seeds auth.users + profiles, so the profiles FK is satisfied
  -- and the invariant below is actually exercised (no FK abort).
  cre := mk_user('cre');
  a   := mk_user('a');
  b   := mk_user('b');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, a, cre, 'active', now()+interval '1 day');
  BEGIN
    insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
      values (inst, b, cre, 'active', now()+interval '1 day');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'INVARIANT FAILED: two active offers allowed on one instance'; END IF;
  RAISE NOTICE 'offer invariant OK';
  ROLLBACK;
END $$;
