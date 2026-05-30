-- supabase/tests/d_reveal_expiry.sql
-- 5b #28 reveal hardening: reveal predicates must respect offer expiry.
-- The active-offer branch is now (status='accepted' OR (status='active' AND expires_at > now())).
-- An offer past expires_at but not yet flipped to 'expired' by the async job must NOT reveal.
-- Verifies:
--   POSITIVE: active offer with expires_at > now()  -> counterpart profile + date_instance readable.
--   NEGATIVE (the fix): active offer with expires_at < now() (not yet job-flipped) -> NOT readable.
--   POSITIVE: accepted offer with expires_at in the past -> STILL readable (accepted not expiry-gated).
--   POSITIVE: lock participant -> readable (lock branch unchanged).
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- ---------------------------------------------------------------------------
-- POSITIVE: active offer, expires_at in the future -> readable (all 3 predicates + RLS).
-- NEGATIVE: same offer pushed past expiry (still 'active') -> NOT readable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; vis int;
BEGIN
  cre  := mk_user('dx_host');
  cand := mk_user('dx_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, email=id::text||'@test.local' where id in (cre, cand);

  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- POSITIVE (future expiry): all three predicates true.
  IF match_reveal_allowed(cand, inst) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 1: match_reveal_allowed should be TRUE for live active offer';
  END IF;
  IF match_reveal_allowed_pair(cre, cand) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 1: match_reveal_allowed_pair(cre,cand) should be TRUE for live active offer';
  END IF;
  IF match_reveal_allowed_pair(cand, cre) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 1: match_reveal_allowed_pair(cand,cre) should be TRUE for live active offer';
  END IF;
  IF match_offer_recipient_can_see_instance(cand, inst) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 1: match_offer_recipient_can_see_instance should be TRUE for live active offer';
  END IF;
  -- RLS: recipient reads the instance.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'dx case 1: recipient should read instance via live active offer (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'dx case 1: live active offer (future expiry) reveals OK';

  -- NEGATIVE (the fix): push offer past expiry, keep status 'active' (job has not flipped it).
  UPDATE offers SET expires_at = now() - interval '1 minute' WHERE id = oid;
  PERFORM 1 FROM offers WHERE id = oid AND status = 'active' AND expires_at < now();
  IF NOT FOUND THEN RAISE EXCEPTION 'dx case 2 setup: offer should be active + expired'; END IF;

  IF match_reveal_allowed(cand, inst) IS NOT FALSE THEN
    RAISE EXCEPTION 'dx case 2: match_reveal_allowed must be FALSE for expired-but-active offer';
  END IF;
  IF match_reveal_allowed_pair(cre, cand) IS NOT FALSE THEN
    RAISE EXCEPTION 'dx case 2: match_reveal_allowed_pair(cre,cand) must be FALSE for expired-but-active offer';
  END IF;
  IF match_reveal_allowed_pair(cand, cre) IS NOT FALSE THEN
    RAISE EXCEPTION 'dx case 2: match_reveal_allowed_pair(cand,cre) must be FALSE for expired-but-active offer';
  END IF;
  IF match_offer_recipient_can_see_instance(cand, inst) IS NOT FALSE THEN
    RAISE EXCEPTION 'dx case 2: match_offer_recipient_can_see_instance must be FALSE for expired-but-active offer';
  END IF;
  -- RLS: recipient can no longer read the instance.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 0 THEN
    RAISE EXCEPTION 'dx case 2: recipient must NOT read instance via expired active offer (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'dx case 2: expired-but-active offer no longer reveals OK (the fix)';

  RAISE NOTICE 'dx: active-offer expiry gating 2 cases OK';
  ROLLBACK;
END $$;

-- ---------------------------------------------------------------------------
-- POSITIVE: accepted offer with expires_at in the PAST -> STILL readable (a lock exists).
-- POSITIVE: lock participant path -> readable (lock branch unchanged).
-- ---------------------------------------------------------------------------
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; lid uuid; vis int;
BEGIN
  cre  := mk_user('dx2_host');
  cand := mk_user('dx2_cand');
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
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- candidate accepts -> offer 'accepted', lock + lock_participants created.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  lid := match_accept_offer(cand, oid, gen_random_uuid());

  -- Force the accepted offer's expires_at into the past: must NOT matter (accepted not gated).
  UPDATE offers SET expires_at = now() - interval '1 hour' WHERE id = oid;
  PERFORM 1 FROM offers WHERE id = oid AND status = 'accepted' AND expires_at < now();
  IF NOT FOUND THEN RAISE EXCEPTION 'dx case 3 setup: offer should be accepted + past expiry'; END IF;

  IF match_reveal_allowed(cand, inst) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 3: accepted offer (past expiry) should STILL reveal via match_reveal_allowed';
  END IF;
  IF match_offer_recipient_can_see_instance(cand, inst) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 3: accepted offer (past expiry) should STILL reveal via offer_recipient helper';
  END IF;
  IF match_reveal_allowed_pair(cre, cand) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 3: accepted offer (past expiry) should STILL reveal via pair helper';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'dx case 3: recipient should still read instance via accepted offer / lock (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'dx case 3: accepted offer with past expiry still reveals OK (not expiry-gated)';

  -- POSITIVE: lock participant path. Delete the offer entirely so reveal can ONLY come from the
  -- lock branch; participant must still be revealed (lock branch unchanged).
  DELETE FROM offers WHERE id = oid;
  PERFORM 1 FROM lock_participants lp JOIN locks l ON l.id = lp.lock_id
    WHERE l.date_instance_id = inst AND lp.user_id = cand AND l.status in ('active','completed');
  IF NOT FOUND THEN RAISE EXCEPTION 'dx case 4 setup: expected an active/completed lock participant'; END IF;

  IF match_reveal_allowed(cand, inst) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 4: lock participant should reveal via match_reveal_allowed (offer removed)';
  END IF;
  IF match_offer_recipient_can_see_instance(cand, inst) IS NOT TRUE THEN
    RAISE EXCEPTION 'dx case 4: lock participant should reveal via offer_recipient helper (offer removed)';
  END IF;
  RAISE NOTICE 'dx case 4: lock-participant path reveals OK (lock branch unchanged)';

  RAISE NOTICE 'dx: accepted + lock paths 2 cases OK';
  ROLLBACK;
END $$;
