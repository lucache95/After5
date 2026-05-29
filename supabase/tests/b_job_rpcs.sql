-- supabase/tests/b_job_rpcs.sql
-- R1 poison-loop backfill: the two job-runner RPCs that were missing.
--   match_bulk_withdraw(p_actor)  — B safety/overflow consumer
--   close_rating_window(p_lock)   — enqueued on every match_accept_offer
-- Conventions follow b_complete.sql (fixtures + DO blocks + ROLLBACK per case).
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- ============================================================================
-- match_bulk_withdraw: withdraw actor from ALL open engagements across instances,
-- resolve an active offer negative, and DO NOT touch a lock the actor holds.
-- ============================================================================
DO $$
DECLARE
  cre uuid; actor uuid; other uuid;
  it uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid;
  oid uuid; lid uuid;
BEGIN
  cre := mk_user('bw_cre'); actor := mk_user('bw_actor'); other := mk_user('bw_other');
  insert into profiles_private(user_id, birthdate)
    values (cre,'1990-01-01'),(actor,'1990-01-01'),(other,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, actor, other);
  it := mk_itinerary(cre);

  -- i1: actor 'interested'   -> should become offer_passed
  -- i2: actor 'shortlisted'  -> should become offer_passed
  i1 := mk_instance(it, cre, now() + interval '3 days');
  i2 := mk_instance(it, cre, now() + interval '4 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (i1, actor, cre, 'interested'), (i2, actor, cre, 'shortlisted');

  -- i3: actor holds an ACTIVE offer -> should be resolved negative (offer passed/expired)
  i3 := mk_instance(it, cre, now() + interval '5 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (i3, actor, cre, 'offer_active');
  insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
    values (i3, actor, cre, 'active', now() + interval '1 hour') returning id into oid;

  -- i4: actor holds a LOCK (locked) -> MUST be untouched by bulk_withdraw
  i4 := mk_instance(it, cre, now() + interval '6 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (i4, actor, cre, 'locked');
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (i4, cre, actor, 'active') returning id into lid;

  -- ACT
  PERFORM match_bulk_withdraw(actor);

  -- ASSERT: queue entries on i1/i2 withdrawn
  PERFORM 1 FROM queue_entries WHERE date_instance_id=i1 AND candidate_id=actor AND status='offer_passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: i1 interested not withdrawn'; END IF;
  PERFORM 1 FROM queue_entries WHERE date_instance_id=i2 AND candidate_id=actor AND status='offer_passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: i2 shortlisted not withdrawn'; END IF;

  -- ASSERT: active offer resolved negative
  PERFORM 1 FROM offers WHERE id=oid AND status IN ('passed','expired');
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: active offer not resolved negative'; END IF;

  -- ASSERT: lock untouched (still active, queue entry still locked)
  PERFORM 1 FROM locks WHERE id=lid AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: lock was disturbed'; END IF;
  PERFORM 1 FROM queue_entries WHERE date_instance_id=i4 AND candidate_id=actor AND status='locked';
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: locked queue entry was disturbed'; END IF;

  -- ASSERT: analytics emitted
  PERFORM 1 FROM analytics_events WHERE event_type='match_bulk_withdraw' AND actor_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: analytics event missing'; END IF;

  -- IDEMPOTENT: second call must not raise and must not change terminal states
  PERFORM match_bulk_withdraw(actor);
  PERFORM 1 FROM offers WHERE id=oid AND status IN ('passed','expired');
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: idempotent re-run changed offer state'; END IF;
  PERFORM 1 FROM locks WHERE id=lid AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_withdraw: idempotent re-run disturbed lock'; END IF;

  RAISE NOTICE 'b_job_rpcs: match_bulk_withdraw OK (withdrew + resolved + lock untouched + idempotent)';
  ROLLBACK;
END $$;

-- ============================================================================
-- match_bulk_withdraw on a user with NOTHING open: clean no-op, no raise.
-- ============================================================================
DO $$
DECLARE u uuid;
BEGIN
  u := mk_user('bw_empty');
  PERFORM match_bulk_withdraw(u);  -- must not raise
  RAISE NOTICE 'b_job_rpcs: match_bulk_withdraw no-op on empty user OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- close_rating_window: marks the lock's rating window closed, idempotent,
-- and cleanly no-ops on a nonexistent lock id.
-- ============================================================================
DO $$
DECLARE cre uuid; cand uuid; it uuid; inst uuid; lid uuid; t1 timestamptz; t2 timestamptz;
BEGIN
  cre := mk_user('rw_cre'); cand := mk_user('rw_cand');
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lid;

  -- ACT
  PERFORM close_rating_window(lid);

  -- ASSERT: rating window marker set
  SELECT rating_closed_at INTO t1 FROM locks WHERE id=lid;
  IF t1 IS NULL THEN RAISE EXCEPTION 'close_rating_window: rating_closed_at not set'; END IF;

  -- IDEMPOTENT: second call is a no-op (does not move the timestamp)
  PERFORM close_rating_window(lid);
  SELECT rating_closed_at INTO t2 FROM locks WHERE id=lid;
  IF t2 IS DISTINCT FROM t1 THEN RAISE EXCEPTION 'close_rating_window: not idempotent (timestamp moved)'; END IF;

  -- CLEAN NO-OP on nonexistent lock: must not raise
  PERFORM close_rating_window(gen_random_uuid());

  RAISE NOTICE 'b_job_rpcs: close_rating_window OK (marker set + idempotent + missing-lock no-op)';
  ROLLBACK;
END $$;

DO $$ BEGIN RAISE NOTICE 'b_job_rpcs: all job-RPC backfill assertions OK'; END $$;
