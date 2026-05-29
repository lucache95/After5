-- supabase/tests/b_complete.sql
-- B-complete: auto_roll, cancel_lock (mutual + safety), basic coverage of cascade consumers.
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- auto_roll promotes next standby on pass
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; oid uuid; newoid uuid;
BEGIN
  cre := mk_user('br1_cre'); c1 := mk_user('br1_c1'); c2 := mk_user('br1_c2');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(c1,'1990-01-01'),(c2,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, c1, c2);
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (c1, inst, cre, 'right'), (c2, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, c1, 1);
  PERFORM match_shortlist(cre, inst, c2, 2);
  oid := (match_make_offer(cre, inst, c1, gen_random_uuid())->>'offer_id')::uuid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c1::text)::text, true);
  PERFORM match_pass_offer(c1, oid);

  SELECT id INTO newoid FROM offers WHERE date_instance_id=inst AND status='active';
  IF newoid IS NULL THEN RAISE EXCEPTION 'B-complete: auto_roll did not create new offer'; END IF;
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=c2 AND status='offer_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete: c2 not promoted'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=c2 AND type='standby_promoted';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete: standby_promoted notification missing'; END IF;
  RAISE NOTICE 'B-complete: auto_roll on pass OK';
  ROLLBACK;
END $$;

-- cancel_lock with mutual reason
DO $$
DECLARE cre uuid; cand uuid; it uuid; inst uuid; oid uuid; lid uuid;
BEGIN
  cre := mk_user('cl1_cre'); cand := mk_user('cl1_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  lid := match_accept_offer(cand, oid, gen_random_uuid());

  PERFORM match_cancel_lock(cand, lid, 'mutual', gen_random_uuid());

  PERFORM 1 FROM locks WHERE id=lid AND status='cancelled' AND cancel_reason='mutual';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete: lock not cancelled with mutual'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=cre AND type='lock_cancelled_rolled';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete: lock_cancelled_rolled notif missing'; END IF;
  PERFORM 1 FROM date_instances WHERE id=inst AND status='seeking';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete: instance not reopened to seeking'; END IF;
  RAISE NOTICE 'B-complete: cancel_lock (mutual) OK';
  ROLLBACK;
END $$;

-- cancel_lock with safety reason (atomicity)
DO $$
DECLARE cre uuid; cand uuid; it uuid; inst uuid; oid uuid; lid uuid;
BEGIN
  cre := mk_user('cl2_cre'); cand := mk_user('cl2_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  lid := match_accept_offer(cand, oid, gen_random_uuid());

  PERFORM match_cancel_lock(cand, lid, 'safety', gen_random_uuid());

  PERFORM 1 FROM locks WHERE id=lid AND status='cancelled' AND cancel_reason='safety';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete safety: lock not cancelled'; END IF;
  PERFORM 1 FROM profiles WHERE id=cre AND standing='warned';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete safety: standing not warned'; END IF;
  PERFORM 1 FROM admin_alerts WHERE kind='safety_lock_cancel' AND payload->>'lock_id'=lid::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete safety: admin_alert not inserted'; END IF;
  PERFORM 1 FROM jobs WHERE type='bulk_withdraw' AND payload->>'user'=cre::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete safety: bulk_withdraw not enqueued'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=cre AND type='lock_cancelled_frozen';
  IF NOT FOUND THEN RAISE EXCEPTION 'B-complete safety: lock_cancelled_frozen missing'; END IF;
  RAISE NOTICE 'B-complete: cancel_lock (safety) atomicity OK';
  ROLLBACK;
END $$;
