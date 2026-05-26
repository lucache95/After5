-- supabase/tests/p0_match_ratings.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE
  cre uuid; usr uuid; itin uuid; inst uuid; l uuid; ok boolean := false;
BEGIN
  -- Structural: one rating per (lock, rater).
  PERFORM 1 FROM pg_indexes
   WHERE tablename='match_ratings' AND indexdef ILIKE '%unique%lock_id%rater_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'match_ratings unique(lock,rater) missing'; END IF;

  -- Behavior: the CHECK (rater_id <> ratee_id) must reject a self-rating. Run as postgres
  -- (RLS bypassed), so this exercises the table CHECK, not the insert policy.
  cre := mk_user('cre'); usr := mk_user('usr');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '2 days');
  insert into locks (date_instance_id,creator_id,matched_user_id) values (inst,cre,usr) returning id into l;
  BEGIN
    insert into match_ratings (lock_id, rater_id, ratee_id, showed_up)
      values (l, cre, cre, true);  -- self-rating
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'CHECK FAILED: self-rating (rater=ratee) was allowed'; END IF;
  RAISE NOTICE 'match_ratings structural + self-rating CHECK OK';
  ROLLBACK;
END $$;
