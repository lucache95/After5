-- supabase/tests/e12_reject_candidate.sql
-- E12 (REQ-E12 / D-04): reject_candidate happy path + errcodes + SILENT + anon-revoke + idempotency.
-- Mirrors a_make_offer.sql harness (\i _fixtures.sql, set_config jwt, per-block ROLLBACK).
\i supabase/tests/_fixtures.sql

-- Feature flag must be enabled for the RPC to run.
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Helper: stand up a shortlisted candidate on a creator's instance.
-- (creator + dating-enabled candidate, swiped right, ingested, shortlisted)

-- (1) Happy path: creator rejects a shortlisted candidate → passed_by_host;
--     (5) SILENT: NO notification row created for the candidate.
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; n int;
BEGIN
  cre := mk_user('rc1_cre'); cand := mk_user('rc1_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  -- creator rejects
  PERFORM reject_candidate(cre, inst, cand);

  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand
    AND status='passed_by_host';
  IF NOT FOUND THEN RAISE EXCEPTION 'E12: reject did not set passed_by_host'; END IF;

  -- SILENT: no notification of ANY type was dispatched to the rejected candidate
  SELECT count(*) INTO n FROM notifications WHERE user_id=cand;
  IF n <> 0 THEN RAISE EXCEPTION 'E12: reject must be SILENT, found % notification(s) for candidate', n; END IF;

  -- analytics row recorded (not a notification)
  PERFORM 1 FROM analytics_events WHERE event_type='candidate_rejected' AND actor_id=cre AND subject_id=cand;
  IF NOT FOUND THEN RAISE EXCEPTION 'E12: candidate_rejected analytics row missing'; END IF;

  -- idempotency: re-reject on an already-passed_by_host row is a no-op success (no raise)
  PERFORM reject_candidate(cre, inst, cand);
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='passed_by_host';
  IF NOT FOUND THEN RAISE EXCEPTION 'E12: idempotent re-reject mutated state'; END IF;

  RAISE NOTICE 'E12: happy path + passed_by_host + SILENT + idempotent OK';
  ROLLBACK;
END $$;

-- (2) 42501: a NON-creator cannot reject (creator-ownership recheck).
DO $$
DECLARE cre uuid; other uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('rc2_cre'); other := mk_user('rc2_other'); cand := mk_user('rc2_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(other,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  -- a different authenticated user (the JWT subject == p_actor) attempts the reject
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text)::text, true);
  BEGIN
    PERFORM reject_candidate(other, inst, cand);
  EXCEPTION
    WHEN sqlstate '42501' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E12: expected 42501, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E12: non-creator reject must raise 42501'; END IF;
  RAISE NOTICE 'E12: 42501 non-creator OK';
  ROLLBACK;
END $$;

-- (3) P5001: p_actor != jwt subject (auth mismatch).
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('rc3_cre'); cand := mk_user('rc3_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  -- jwt cleared → auth.uid() is null, p_actor=cre → mismatch
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM reject_candidate(cre, inst, cand);
  EXCEPTION
    WHEN sqlstate 'P5001' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E12: expected P5001, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E12: actor!=jwt must raise P5001'; END IF;
  RAISE NOTICE 'E12: P5001 auth_mismatch OK';
  ROLLBACK;
END $$;

-- (4) cannot_reject_active_offer (P0001): the active offer-holder must not be rejectable.
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('rc4_cre'); cand := mk_user('rc4_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  -- promote to an active offer
  PERFORM match_make_offer(cre, inst, cand, gen_random_uuid());

  BEGIN
    PERFORM reject_candidate(cre, inst, cand);
  EXCEPTION
    WHEN sqlstate 'P0001' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E12: expected P0001, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E12: rejecting offer-holder must raise cannot_reject_active_offer (P0001)'; END IF;
  RAISE NOTICE 'E12: P0001 cannot_reject_active_offer OK';
  ROLLBACK;
END $$;

-- (6) anon cannot EXECUTE reject_candidate (auto-grant revoked).
DO $$
DECLARE has_anon boolean;
BEGIN
  SELECT has_function_privilege('anon', 'reject_candidate(uuid,uuid,uuid)', 'EXECUTE')
    INTO has_anon;
  IF has_anon THEN RAISE EXCEPTION 'E12: anon must NOT have EXECUTE on reject_candidate'; END IF;
  RAISE NOTICE 'E12: anon EXECUTE revoked OK';
END $$;
