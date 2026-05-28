-- supabase/tests/a_accept_lock.sql
-- A.5: match_accept_offer happy path + errcodes + idempotency + jobs enqueued.
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Happy path: shortlist → offer → accept → lock + thread promoted + jobs enqueued + notifications
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; lid uuid; idem uuid;
BEGIN
  cre := mk_user('al1_cre'); cand := mk_user('al1_cand');
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
  oid := match_make_offer(cre, inst, cand, gen_random_uuid());

  -- Now candidate accepts
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  idem := gen_random_uuid();
  lid := match_accept_offer(cand, oid, idem);
  IF lid IS NULL THEN RAISE EXCEPTION 'A.5: accept_offer returned NULL'; END IF;

  -- lock row exists, active
  PERFORM 1 FROM locks WHERE id=lid AND status='active' AND date_instance_id=inst;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.5: lock row not active'; END IF;

  -- offer resolved to 'accepted'
  PERFORM 1 FROM offers WHERE id=oid AND status='accepted' AND resolved_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.5: offer not resolved to accepted'; END IF;

  -- queue_entries → locked
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='locked';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.5: queue_entries not locked'; END IF;

  -- date_instances → matched
  PERFORM 1 FROM date_instances WHERE id=inst AND status='matched';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.5: date_instances not matched'; END IF;

  -- chat_threads promoted
  PERFORM 1 FROM chat_threads WHERE offer_id=oid AND state='promoted' AND lock_id=lid AND promoted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.5: chat_thread not promoted with lock_id + promoted_at'; END IF;

  -- offer_expiry job cancelled (status='cancelled')
  PERFORM 1 FROM jobs WHERE type='offer_expiry' AND dedup_key=oid::text AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.5: offer_expiry job not cancelled'; END IF;

  -- standby_roll jobs enqueued (autoclose_creator + autowithdraw_user)
  IF (SELECT count(*) FROM jobs WHERE type='standby_roll' AND payload->>'kind' IN ('autoclose_creator_conflicts','autowithdraw_user_conflicts')
       AND (payload->>'creator' = cre::text OR payload->>'user' = cand::text)) < 2 THEN
    RAISE EXCEPTION 'A.5: standby_roll cascade jobs not enqueued';
  END IF;

  -- rating_window job enqueued
  PERFORM 1 FROM jobs WHERE type='rating_window' AND dedup_key='rating:'||lid::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.5: rating_window job not enqueued'; END IF;

  -- new_match notifications to BOTH parties
  IF (SELECT count(*) FROM notifications WHERE type='new_match' AND user_id IN (cre, cand)) <> 2 THEN
    RAISE EXCEPTION 'A.5: new_match notifications expected 2, got %',
      (SELECT count(*) FROM notifications WHERE type='new_match' AND user_id IN (cre, cand));
  END IF;

  -- idempotency replay returns same lid
  IF match_accept_offer(cand, oid, idem) <> lid THEN
    RAISE EXCEPTION 'A.5: idempotency replay returned different lid';
  END IF;

  RAISE NOTICE 'A.5: accept_offer happy path + idempotency OK';
  ROLLBACK;
END $$;

-- P5007: offer expired
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; ok boolean := false;
BEGIN
  cre := mk_user('al2_cre'); cand := mk_user('al2_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := match_make_offer(cre, inst, cand, gen_random_uuid());

  -- Force expiry by setting expires_at in the past
  update offers set expires_at = now() - interval '1 minute' where id=oid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  BEGIN
    PERFORM match_accept_offer(cand, oid, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P5007' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'A.5: expected P5007, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.5: expired offer must raise P5007'; END IF;
  RAISE NOTICE 'A.5: P5007 offer_expired OK';
  ROLLBACK;
END $$;

-- P5001: auth mismatch (someone else tries to accept)
DO $$
DECLARE cre uuid; cand uuid; other uuid; itin uuid; inst uuid; oid uuid; ok boolean := false;
BEGIN
  cre := mk_user('al3_cre'); cand := mk_user('al3_cand'); other := mk_user('al3_other');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01'), (other, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand, other);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := match_make_offer(cre, inst, cand, gen_random_uuid());

  -- Other user tries to accept (auth.uid != p_actor)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text)::text, true);
  BEGIN
    PERFORM match_accept_offer(cand, oid, gen_random_uuid());  -- p_actor=cand but auth.uid=other
  EXCEPTION
    WHEN sqlstate 'P5001' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'A.5: expected P5001, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.5: auth-mismatch must raise P5001'; END IF;
  RAISE NOTICE 'A.5: P5001 auth_mismatch OK';
  ROLLBACK;
END $$;
