-- supabase/tests/p0_offer_invariant.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE inst uuid; cre uuid; a uuid; b uuid; itin uuid; off_a uuid; ok boolean := false;
BEGIN
  -- C8 fixtures: mk_user seeds auth.users + profiles, so the profiles FK is satisfied
  -- and the invariant below is actually exercised (no FK abort).
  cre := mk_user('cre');
  a   := mk_user('a');
  b   := mk_user('b');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, a, cre, 'active', now()+interval '1 day') returning id into off_a;
  BEGIN
    insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
      values (inst, b, cre, 'active', now()+interval '1 day');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'INVARIANT FAILED: two active offers allowed on one instance'; END IF;
  RAISE NOTICE 'offer invariant OK';

  -- Positive path: the index is PARTIAL (where status='active'), so once the first offer
  -- is resolved a new active offer on the same instance must be allowed. (A non-partial
  -- unique index would wrongly block this and this insert would raise.)
  update offers set status='passed', resolved_at=now() where id=off_a;
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, b, cre, 'active', now()+interval '1 day');
  RAISE NOTICE 'offer re-activation after resolution OK';
  ROLLBACK;
END $$;
