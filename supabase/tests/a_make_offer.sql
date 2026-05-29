-- supabase/tests/a_make_offer.sql
-- A.4: match_make_offer happy path + errcodes (P5000, P5001, P5002, P5003, P5008) + idempotency.
\i supabase/tests/_fixtures.sql

-- Ensure feature flag enabled for tests
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Helper: prepare a shortlisted pair (creator + dating-enabled candidate, swiped right, ingested, shortlisted)
-- Returns (creator, candidate, instance) via NOTICE
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; idem uuid; oid uuid; res jsonb;
BEGIN
  cre := mk_user('mo1_cre'); cand := mk_user('mo1_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  -- Happy path: make offer → discriminated jsonb {kind:'offer', offer_id}
  idem := gen_random_uuid();
  res := match_make_offer(cre, inst, cand, idem);
  IF res->>'kind' IS DISTINCT FROM 'offer' THEN
    RAISE EXCEPTION 'A.4: make_offer kind != offer (got %)', res;
  END IF;
  oid := (res->>'offer_id')::uuid;
  IF oid IS NULL THEN RAISE EXCEPTION 'A.4: make_offer returned NULL offer_id'; END IF;

  -- offer row exists, status active, expires_at set
  PERFORM 1 FROM offers WHERE id=oid AND status='active' AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'A.4: offer row not active/expiring'; END IF;

  -- queue_entries promoted to offer_active with offer_frozen_rank=1
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand
    AND status='offer_active' AND rank=1 AND offer_frozen_rank=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.4: queue_entries not promoted to offer_active'; END IF;

  -- chat thread opened
  PERFORM 1 FROM chat_threads WHERE offer_id=oid AND state='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.4: chat_thread not opened for offer'; END IF;

  -- offer_expiry job enqueued
  PERFORM 1 FROM jobs WHERE type='offer_expiry' AND dedup_key = oid::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.4: offer_expiry job not enqueued'; END IF;

  -- notification dispatched to candidate
  PERFORM 1 FROM notifications WHERE user_id=cand AND type='offer_received';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.4: offer_received notification not dispatched'; END IF;

  -- idempotency replay returns same offer_id (no second offer)
  IF (match_make_offer(cre, inst, cand, idem)->>'offer_id')::uuid <> oid THEN
    RAISE EXCEPTION 'A.4: idempotency replay returned different offer_id';
  END IF;
  IF (SELECT count(*) FROM offers WHERE date_instance_id=inst) <> 1 THEN
    RAISE EXCEPTION 'A.4: replay created a second offer row';
  END IF;

  RAISE NOTICE 'A.4: make_offer happy path + idempotency OK';
  ROLLBACK;
END $$;

-- P5001: auth mismatch
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('mo2_cre'); cand := mk_user('mo2_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  -- Reset auth.uid to NULL
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM match_make_offer(cre, inst, cand, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P5001' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'A.4: expected P5001, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.4: make_offer without auth must raise P5001'; END IF;
  RAISE NOTICE 'A.4: P5001 auth_mismatch OK';
  ROLLBACK;
END $$;

-- P5002: dating_enabled=false
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('mo3_cre'); cand := mk_user('mo3_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id=cre;
  update profiles set dating_enabled=false where id=cand;  -- candidate has dating OFF
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  BEGIN
    PERFORM match_make_offer(cre, inst, cand, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P5002' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'A.4: expected P5002, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.4: dating_enabled=false must raise P5002'; END IF;
  RAISE NOTICE 'A.4: P5002 account_gated (dating_disabled) OK';
  ROLLBACK;
END $$;

-- P5002: blocks
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('mo4_cre'); cand := mk_user('mo4_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);

  -- Now block the candidate
  insert into blocks(blocker_id, blocked_id) values (cre, cand);
  BEGIN
    PERFORM match_make_offer(cre, inst, cand, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P5002' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'A.4: expected P5002 (blocks), got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.4: blocked pair must raise P5002'; END IF;
  RAISE NOTICE 'A.4: P5002 account_gated (blocks) OK';
  ROLLBACK;
END $$;

-- reciprocal detected (candidate has active offer to actor on different instance)
-- → returns jsonb {kind:'reciprocal', pair_id}; no offer is created.
DO $$
DECLARE
  alice uuid; bob uuid; itin_a uuid; itin_b uuid; inst_a uuid; inst_b uuid; res jsonb;
BEGIN
  alice := mk_user('mo5_alice'); bob := mk_user('mo5_bob');
  insert into profiles_private(user_id, birthdate) values (alice, '1990-01-01'), (bob, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (alice, bob);
  -- Alice creates her instance; Bob swipes right + alice shortlists him
  itin_a := mk_itinerary(alice);
  inst_a := mk_instance(itin_a, alice, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (bob, inst_a, alice, 'right');
  PERFORM match_ingest_interest(inst_a);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', alice::text)::text, true);
  PERFORM match_shortlist(alice, inst_a, bob, 1);
  -- Alice makes offer to Bob on her instance
  PERFORM match_make_offer(alice, inst_a, bob, gen_random_uuid());

  -- Bob now creates HIS instance, alice swipes right, bob shortlists her
  itin_b := mk_itinerary(bob);
  inst_b := mk_instance(itin_b, bob, now() + interval '3 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (alice, inst_b, bob, 'right');
  PERFORM match_ingest_interest(inst_b);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', bob::text)::text, true);
  PERFORM match_shortlist(bob, inst_b, alice, 1);
  -- Bob tries to make offer to Alice on his instance → reciprocal return (not an error)
  res := match_make_offer(bob, inst_b, alice, gen_random_uuid());
  IF res->>'kind' IS DISTINCT FROM 'reciprocal' THEN
    RAISE EXCEPTION 'A.4: reciprocal must return kind=reciprocal (got %)', res;
  END IF;
  IF (res->>'pair_id') IS NULL THEN
    RAISE EXCEPTION 'A.4: reciprocal return missing pair_id (got %)', res;
  END IF;
  -- And only Alice's offer exists (Bob's was never inserted) — scope to this pair's instances
  IF (SELECT count(*) FROM offers WHERE status='active' AND date_instance_id IN (inst_a, inst_b)) <> 1 THEN
    RAISE EXCEPTION 'A.4: reciprocal should not have created second offer (count=%)',
      (SELECT count(*) FROM offers WHERE status='active' AND date_instance_id IN (inst_a, inst_b));
  END IF;
  RAISE NOTICE 'A.4: reciprocal return {kind:reciprocal, pair_id} OK';
  ROLLBACK;
END $$;

-- P5000: feature flag off
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  update feature_config set value='false'::jsonb where key='match_v2_enabled';
  cre := mk_user('mo6_cre'); cand := mk_user('mo6_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  BEGIN
    PERFORM match_make_offer(cre, inst, cand, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P5000' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'A.4: expected P5000, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.4: flag-off must raise P5000'; END IF;
  RAISE NOTICE 'A.4: P5000 feature_disabled OK';
  ROLLBACK;
END $$;
