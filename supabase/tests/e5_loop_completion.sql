-- supabase/tests/e5_loop_completion.sql
-- REQ-E5 (D-01/D-02/D-03): the loop terminus.
--   sweep_loop_terminus() — service-role batch sweep:
--     (a) past-dated ACTIVE lock      -> lock 'completed' + date_instance 'completed'
--                                        + a 'rating_window' job enqueued (rating UX coordination)
--     (b) past-dated 'seeking' night  -> date_instance 'expired' (NOT 'completed')
--     idempotent: a second run produces no error and no further state change.
--     a FUTURE-dated active lock is NOT swept.
--   flag_no_show(p_actor,p_lock,p_idem_key) — membership-auth DEFINER:
--     by a MEMBER (matched_user)       -> lock 'no_show'; date_instance stays 'completed'.
--     by a NON-member                  -> raises (errcode 42501).
--
-- Conventions: psql assertions (NOT pgTAP) — \i fixtures, DO blocks, RAISE on failed assert,
-- ROLLBACK per case. auth.uid() is set via request.jwt.claims 'sub' (see a_make_offer.sql).
-- PAST-dated instances are inserted via the mk_instance fixture (post_night's starts_at>now()
-- guard would reject past data).
\i supabase/tests/_fixtures.sql

-- ============================================================================
-- (a) COMPLETION: a past-dated ACTIVE lock -> lock 'completed' + instance 'completed'
--     + a rating_window job enqueued. And a FUTURE-dated active lock is untouched.
-- ============================================================================
DO $$
DECLARE
  cre uuid; cand uuid; it uuid;
  inst_past uuid; inst_future uuid;
  lid_past uuid; lid_future uuid;
  ret int;
BEGIN
  cre := mk_user('e5c_cre'); cand := mk_user('e5c_cand');
  it := mk_itinerary(cre);

  -- past-dated night that ended well over the 3h grace ago; lock is ACTIVE + instance 'matched'
  inst_past := mk_instance(it, cre, now() - interval '1 day');
  update date_instances set status='matched' where id=inst_past;
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst_past, cre, cand, 'active') returning id into lid_past;

  -- future-dated night; lock ACTIVE + instance 'matched' — MUST NOT be swept
  inst_future := mk_instance(it, cre, now() + interval '3 days');
  update date_instances set status='matched' where id=inst_future;
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst_future, cre, cand, 'active') returning id into lid_future;

  -- ACT
  ret := sweep_loop_terminus();

  -- ASSERT: the sweep reported >= 1 completed lock
  IF ret < 1 THEN RAISE EXCEPTION 'E5: sweep returned %, expected >=1 completed lock', ret; END IF;

  -- ASSERT: past lock -> completed, past instance -> completed
  PERFORM 1 FROM locks WHERE id=lid_past AND status='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: past-dated active lock not completed'; END IF;
  PERFORM 1 FROM date_instances WHERE id=inst_past AND status='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: past-dated matched instance not completed'; END IF;

  -- ASSERT (rating-window coordination): a rating_window job was enqueued for the completed lock,
  -- keyed exactly as accept_lock keys it ('rating:'||lock_id). Without this, E17 has nothing to
  -- aggregate from a cron-completed date.
  PERFORM 1 FROM jobs WHERE type='rating_window' AND dedup_key='rating:'||lid_past::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: rating_window job not enqueued for cron-completed lock'; END IF;

  -- ASSERT: future lock + future instance untouched
  PERFORM 1 FROM locks WHERE id=lid_future AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: future-dated active lock was wrongly swept'; END IF;
  PERFORM 1 FROM date_instances WHERE id=inst_future AND status='matched';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: future-dated matched instance was wrongly swept'; END IF;

  RAISE NOTICE 'E5: completion sweep OK (past completed + rating_window enqueued + future untouched)';
  ROLLBACK;
END $$;

-- ============================================================================
-- (b) EXPIRY: a past-dated 'seeking' night with no lock -> 'expired' (NOT 'completed').
-- ============================================================================
DO $$
DECLARE cre uuid; it uuid; inst_seek uuid; inst_future_seek uuid;
BEGIN
  cre := mk_user('e5e_cre'); it := mk_itinerary(cre);

  -- past-dated seeking night, no lock -> should expire (fixture sets status='seeking')
  inst_seek := mk_instance(it, cre, now() - interval '2 days');
  -- future-dated seeking night -> must NOT expire
  inst_future_seek := mk_instance(it, cre, now() + interval '5 days');

  PERFORM sweep_loop_terminus();

  PERFORM 1 FROM date_instances WHERE id=inst_seek AND status='expired';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: past-dated seeking night not expired'; END IF;
  -- explicitly NOT completed
  PERFORM 1 FROM date_instances WHERE id=inst_seek AND status='completed';
  IF FOUND THEN RAISE EXCEPTION 'E5: past-dated seeking night wrongly set to completed (must be expired)'; END IF;

  PERFORM 1 FROM date_instances WHERE id=inst_future_seek AND status='seeking';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: future-dated seeking night was wrongly expired'; END IF;

  RAISE NOTICE 'E5: expiry sweep OK (past seeking -> expired, future seeking untouched)';
  ROLLBACK;
END $$;

-- ============================================================================
-- IDEMPOTENCY: running the sweep twice produces no error and no further state change.
-- ============================================================================
DO $$
DECLARE
  cre uuid; cand uuid; it uuid; inst_past uuid; lid uuid;
  job_count_1 int; job_count_2 int;
BEGIN
  cre := mk_user('e5i_cre'); cand := mk_user('e5i_cand'); it := mk_itinerary(cre);
  inst_past := mk_instance(it, cre, now() - interval '1 day');
  update date_instances set status='matched' where id=inst_past;
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst_past, cre, cand, 'active') returning id into lid;

  PERFORM sweep_loop_terminus();
  SELECT count(*) INTO job_count_1 FROM jobs WHERE type='rating_window' AND dedup_key='rating:'||lid::text;

  -- second run: must not raise, must not re-enqueue or re-transition
  PERFORM sweep_loop_terminus();
  SELECT count(*) INTO job_count_2 FROM jobs WHERE type='rating_window' AND dedup_key='rating:'||lid::text;

  IF job_count_1 <> 1 THEN RAISE EXCEPTION 'E5: expected exactly 1 rating_window job after first sweep, got %', job_count_1; END IF;
  IF job_count_2 <> 1 THEN RAISE EXCEPTION 'E5: idempotent re-sweep duplicated rating_window job (got %)', job_count_2; END IF;

  PERFORM 1 FROM locks WHERE id=lid AND status='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: idempotent re-sweep changed completed lock state'; END IF;

  RAISE NOTICE 'E5: idempotent sweep OK (no duplicate job, terminal state stable)';
  ROLLBACK;
END $$;

-- ============================================================================
-- flag_no_show BY A MEMBER (matched_user): lock -> 'no_show'; instance stays 'completed'.
-- ============================================================================
DO $$
DECLARE cre uuid; cand uuid; it uuid; inst uuid; lid uuid;
BEGIN
  cre := mk_user('e5n_cre'); cand := mk_user('e5n_cand'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() - interval '1 day');
  update date_instances set status='completed' where id=inst;  -- the date ran (completion already happened)
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'completed') returning id into lid;

  -- the MATCHED user (a member, not the creator) flags the no-show (D-01: EITHER party)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM flag_no_show(cand, lid, gen_random_uuid());

  PERFORM 1 FROM locks WHERE id=lid AND status='no_show';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: flag_no_show by matched member did not set lock no_show'; END IF;

  -- Pitfall 1: date_instances must NEVER be set to no_show (enum has no such value). Stays 'completed'.
  PERFORM 1 FROM date_instances WHERE id=inst AND status='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: date_instance status wrongly changed away from completed'; END IF;

  -- analytics emitted
  PERFORM 1 FROM analytics_events WHERE event_type='lock_no_show_flagged' AND subject_id=lid;
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: lock_no_show_flagged analytics missing'; END IF;

  RAISE NOTICE 'E5: flag_no_show by member OK (lock no_show, instance still completed)';
  ROLLBACK;
END $$;

-- ============================================================================
-- flag_no_show idempotency: same idem_key replays cleanly (no error, single transition).
-- ============================================================================
DO $$
DECLARE cre uuid; cand uuid; it uuid; inst uuid; lid uuid; idem uuid;
BEGIN
  cre := mk_user('e5ni_cre'); cand := mk_user('e5ni_cand'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() - interval '1 day');
  update date_instances set status='completed' where id=inst;
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'completed') returning id into lid;

  idem := gen_random_uuid();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM flag_no_show(cre, lid, idem);
  PERFORM flag_no_show(cre, lid, idem);  -- replay must not raise

  PERFORM 1 FROM locks WHERE id=lid AND status='no_show';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: flag_no_show idempotent replay lost the no_show state'; END IF;

  RAISE NOTICE 'E5: flag_no_show idempotency OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- flag_no_show BY A NON-member: raises 42501.
-- ============================================================================
DO $$
DECLARE cre uuid; cand uuid; stranger uuid; it uuid; inst uuid; lid uuid; ok boolean := false;
BEGIN
  cre := mk_user('e5x_cre'); cand := mk_user('e5x_cand'); stranger := mk_user('e5x_stranger');
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() - interval '1 day');
  update date_instances set status='completed' where id=inst;
  insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'completed') returning id into lid;

  -- a non-member tries to flag — must be rejected with 42501
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  BEGIN
    PERFORM flag_no_show(stranger, lid, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate '42501' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E5: flag_no_show non-member expected 42501, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E5: flag_no_show by non-member must raise 42501'; END IF;

  -- lock unchanged (still completed, not no_show)
  PERFORM 1 FROM locks WHERE id=lid AND status='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: rejected non-member call still mutated the lock'; END IF;

  RAISE NOTICE 'E5: flag_no_show non-member rejected (42501) OK';
  ROLLBACK;
END $$;

DO $$ BEGIN RAISE NOTICE 'e5_loop_completion: all E5 assertions OK'; END $$;
