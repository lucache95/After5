-- supabase/tests/p0_lock_overlap.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; it1 uuid; it2 uuid; i1 uuid; i2 uuid; l1 uuid; ok boolean := false;
BEGIN
  -- C8 fixtures (seed auth.users + profiles so the invariant is actually exercised).
  cre := mk_user('cre');
  usr := mk_user('u');
  it1 := mk_itinerary(cre);
  i1  := mk_instance(it1, cre, timestamptz '2026-06-01 19:00Z');   -- duration default 150 min
  it2 := mk_itinerary(cre);
  i2  := mk_instance(it2, cre, timestamptz '2026-06-01 20:00Z');   -- overlaps i1
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (i1, cre, usr, 'active') returning id into l1;
  BEGIN
    insert into locks (date_instance_id, creator_id, matched_user_id, status)
      values (i2, cre, usr, 'active');  -- usr now double-booked on overlapping window
  EXCEPTION WHEN exclusion_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'INVARIANT FAILED: overlapping double-booking allowed'; END IF;
  RAISE NOTICE 'lock overlap invariant OK';

  -- Regression guard: a lock status UPDATE must succeed. The set_locks_updated_at trigger
  -- calls set_updated_at() which assigns new.updated_at, so locks MUST have an updated_at
  -- column. Completion/cancellation (S6/S8) and the audit_log test depend on this working.
  update locks set status='completed' where id=l1;
  IF (select status from locks where id=l1) <> 'completed'
    THEN RAISE EXCEPTION 'lock status UPDATE failed'; END IF;
  RAISE NOTICE 'lock UPDATE (updated_at trigger) OK';
  ROLLBACK;
END $$;
