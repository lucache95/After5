-- supabase/tests/e24_withdraw_interest.sql
-- E24 (REQ-E24): withdraw_interest DEFINER RPC + queue_entries candidate-read RLS.
-- Asserts:
--   (1) owner-delete-only: caller deletes ONLY their own `interested` row for the instance
--   (2) non-owner actor → P5001 (auth_mismatch), no delete
--   (3) status-scope: a same-candidate shortlisted/offer/locked row for the same instance survives
--   (4) candidate-read RLS: a candidate reads their own queue_entries(status, rank);
--       a different candidate CANNOT read it (queue_candidate_read_own deny-non-owner)
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- (1) owner-delete-only: withdraw_interest removes the caller's own interested row.
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; n int;
BEGIN
  cre := mk_user('wi1_cre'); cand := mk_user('wi1_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- precondition: candidate has an `interested` queue row
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='interested';
  IF NOT FOUND THEN RAISE EXCEPTION 'E24(1): expected interested queue row precondition'; END IF;

  -- candidate withdraws their own plain interest
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM withdraw_interest(inst, cand);

  SELECT count(*) INTO n FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand;
  IF n <> 0 THEN RAISE EXCEPTION 'E24(1): own interested row should be deleted (saw % rows)', n; END IF;

  RAISE NOTICE 'E24(1): owner-delete-only OK';
  ROLLBACK;
END $$;

-- (1b) default p_actor = auth.uid(): caller can omit p_actor.
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; n int;
BEGIN
  cre := mk_user('wi1b_cre'); cand := mk_user('wi1b_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM withdraw_interest(inst);  -- p_actor defaults to auth.uid()

  SELECT count(*) INTO n FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand;
  IF n <> 0 THEN RAISE EXCEPTION 'E24(1b): default p_actor delete failed (saw % rows)', n; END IF;

  RAISE NOTICE 'E24(1b): default p_actor=auth.uid() OK';
  ROLLBACK;
END $$;

-- (2) non-owner actor → P5001 auth_mismatch, no delete.
DO $$
DECLARE cre uuid; cand uuid; other uuid; itin uuid; inst uuid; n int; got_p5001 boolean := false;
BEGIN
  cre := mk_user('wi2_cre'); cand := mk_user('wi2_cand'); other := mk_user('wi2_other');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01'),(other,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand, other);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- `other` authenticates and tries to withdraw `cand`'s interest
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text)::text, true);
  BEGIN
    PERFORM withdraw_interest(inst, cand);
  EXCEPTION WHEN sqlstate 'P5001' THEN
    got_p5001 := true;
  END;
  IF NOT got_p5001 THEN RAISE EXCEPTION 'E24(2): non-owner should raise P5001 auth_mismatch'; END IF;

  -- cand's row untouched
  SELECT count(*) INTO n FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='interested';
  IF n <> 1 THEN RAISE EXCEPTION 'E24(2): candidate row must survive a non-owner attempt (saw % rows)', n; END IF;

  RAISE NOTICE 'E24(2): non-owner P5001 + no-delete OK';
  ROLLBACK;
END $$;

-- (3) status-scope: a shortlisted (non-interested) row for the same candidate+instance survives.
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; v_status queue_status;
BEGIN
  cre := mk_user('wi3_cre'); cand := mk_user('wi3_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  -- creator shortlists the candidate → status flips off 'interested'
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  -- candidate calls withdraw_interest — must NOT delete a shortlisted row
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM withdraw_interest(inst, cand);

  SELECT status INTO v_status FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand;
  IF v_status IS NULL THEN RAISE EXCEPTION 'E24(3): shortlisted row was wrongly deleted'; END IF;
  IF v_status <> 'shortlisted' THEN RAISE EXCEPTION 'E24(3): shortlisted row mutated to %', v_status; END IF;

  RAISE NOTICE 'E24(3): status-scope (shortlisted survives) OK';
  ROLLBACK;
END $$;

-- (4) candidate-read RLS: own row readable; a different candidate cannot read it.
DO $$
DECLARE cre uuid; cand uuid; other uuid; itin uuid; inst uuid; n_self int; n_other int;
BEGIN
  cre := mk_user('wi4_cre'); cand := mk_user('wi4_cand'); other := mk_user('wi4_other');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01'),(other,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand, other);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- candidate reads their own row (status, rank) under authenticated RLS
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_self FROM queue_entries
    WHERE date_instance_id=inst AND candidate_id=cand;
  RESET ROLE;
  IF n_self <> 1 THEN RAISE EXCEPTION 'E24(4): candidate should read own queue row (saw %)', n_self; END IF;

  -- a different candidate must NOT read cand's row
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_other FROM queue_entries
    WHERE date_instance_id=inst AND candidate_id=cand;
  RESET ROLE;
  IF n_other <> 0 THEN RAISE EXCEPTION 'E24(4): non-owner candidate must NOT read the row (saw %)', n_other; END IF;

  RAISE NOTICE 'E24(4): candidate-read RLS deny-non-owner OK';
  ROLLBACK;
END $$;
