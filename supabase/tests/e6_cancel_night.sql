-- supabase/tests/e6_cancel_night.sql
-- REQ-E6 (D-04 / D-06): cancel_night — host SOFT-cancels a pre-match seeking night.
--   creator cancels own 'seeking' night  -> status 'cancelled'; the row + queue_entries KEPT.
--   interested/shortlisted/standby candidates -> each gets a 'night_cancelled' notification.
--   non-creator                          -> raises 42501 (creator-only); no mutation.
--   non-'seeking' (e.g. 'matched')        -> raises P0001 (not_cancellable, pre-match only).
--   idempotent replay (same idem_key)     -> no error, no double-notify, single state change.
--
-- Conventions: psql assertions (NOT pgTAP) — \i fixtures, DO blocks, RAISE on failed assert,
-- ROLLBACK per case. auth.uid() is set via request.jwt.claims 'sub' (see a_make_offer.sql /
-- e5_loop_completion.sql). queue_entries are inserted directly (their RLS grants SELECT only;
-- the fixture path mirrors how match_ingest_interest would have populated them).
\i supabase/tests/_fixtures.sql

-- ============================================================================
-- HAPPY PATH: creator soft-cancels own seeking night; row kept, interested candidates notified.
-- ============================================================================
DO $$
DECLARE
  cre uuid; c1 uuid; c2 uuid; c3 uuid; it uuid; inst uuid;
BEGIN
  cre := mk_user('e6h_cre');
  c1  := mk_user('e6h_c1');   -- interested
  c2  := mk_user('e6h_c2');   -- shortlisted
  c3  := mk_user('e6h_c3');   -- standby
  it  := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');  -- fixture sets status='seeking'

  -- three already-interested candidates across the pre-match statuses cancel must notify
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (inst, c1, cre, 'interested'),
           (inst, c2, cre, 'shortlisted'),
           (inst, c3, cre, 'standby');

  -- the creator cancels
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM cancel_night(cre, inst, gen_random_uuid());

  -- ASSERT: SOFT-cancel — status flipped, but the row still exists.
  PERFORM 1 FROM date_instances WHERE id=inst AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: seeking night was not soft-cancelled to cancelled'; END IF;

  -- ASSERT: interest data is KEPT (reversible) — all three queue rows survive.
  IF (SELECT count(*) FROM queue_entries WHERE date_instance_id=inst) <> 3 THEN
    RAISE EXCEPTION 'E6: cancel removed queue_entries (must be soft/reversible, data kept)';
  END IF;

  -- ASSERT: each interested candidate got a night_cancelled notification.
  PERFORM 1 FROM notifications WHERE user_id=c1 AND type='night_cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: interested candidate c1 not notified (night_cancelled)'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=c2 AND type='night_cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: shortlisted candidate c2 not notified (night_cancelled)'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=c3 AND type='night_cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: standby candidate c3 not notified (night_cancelled)'; END IF;

  -- ASSERT: the notification carries the instance id (deep-link payload).
  PERFORM 1 FROM notifications WHERE user_id=c1 AND type='night_cancelled'
    AND payload->>'date_instance_id' = inst::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: night_cancelled payload missing date_instance_id'; END IF;

  -- ASSERT: analytics emitted.
  PERFORM 1 FROM analytics_events WHERE event_type='night_cancelled' AND subject_id=inst;
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: night_cancelled analytics missing'; END IF;

  RAISE NOTICE 'E6: happy path OK (soft-cancel, data kept, interested candidates notified)';
  ROLLBACK;
END $$;

-- ============================================================================
-- NON-CREATOR: a stranger calling cancel_night is rejected (42501); no mutation.
-- ============================================================================
DO $$
DECLARE cre uuid; stranger uuid; it uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('e6x_cre'); stranger := mk_user('e6x_stranger');
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');

  -- the stranger's idem ledger entry is keyed by p_actor=stranger, so this exercises the
  -- ownership check, not idempotency. auth.uid() = stranger to pass the auth re-check.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  BEGIN
    PERFORM cancel_night(stranger, inst, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate '42501' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E6: non-creator expected 42501, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E6: non-creator cancel must raise 42501'; END IF;

  -- the night is untouched (still seeking)
  PERFORM 1 FROM date_instances WHERE id=inst AND status='seeking';
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: rejected non-creator call still mutated the night'; END IF;

  RAISE NOTICE 'E6: non-creator rejected (42501) OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- NON-SEEKING: cancelling a 'matched' night is rejected (P0001, pre-match only / D-04).
-- ============================================================================
DO $$
DECLARE cre uuid; it uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('e6m_cre'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  update date_instances set status='matched' where id=inst;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  BEGIN
    PERFORM cancel_night(cre, inst, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P0001' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E6: matched-night cancel expected P0001, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E6: cancelling a non-seeking night must raise P0001'; END IF;

  -- night unchanged (still matched)
  PERFORM 1 FROM date_instances WHERE id=inst AND status='matched';
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: rejected matched-night cancel still mutated the night'; END IF;

  RAISE NOTICE 'E6: non-seeking (matched) cancel rejected (P0001) OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- IDEMPOTENCY: a replay with the same idem_key is a no-op (no error, no double-notify).
-- ============================================================================
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; idem uuid; notif_count int;
BEGIN
  cre := mk_user('e6i_cre'); c1 := mk_user('e6i_c1'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (inst, c1, cre, 'interested');

  idem := gen_random_uuid();
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM cancel_night(cre, inst, idem);
  PERFORM cancel_night(cre, inst, idem);  -- replay must not raise

  -- still exactly one night_cancelled notification for the candidate (no double-notify)
  SELECT count(*) INTO notif_count FROM notifications WHERE user_id=c1 AND type='night_cancelled';
  IF notif_count <> 1 THEN
    RAISE EXCEPTION 'E6: idempotent replay double-notified (got % night_cancelled rows)', notif_count;
  END IF;

  -- terminal state stable
  PERFORM 1 FROM date_instances WHERE id=inst AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'E6: idempotent replay lost the cancelled state'; END IF;

  RAISE NOTICE 'E6: idempotency OK (single transition, single notification)';
  ROLLBACK;
END $$;

DO $$ BEGIN RAISE NOTICE 'e6_cancel_night: all E6 assertions OK'; END $$;
