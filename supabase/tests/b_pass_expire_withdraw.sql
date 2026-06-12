-- supabase/tests/b_pass_expire_withdraw.sql
-- B-lite: pass + expire + withdraw + notifications.
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- pass_offer: candidate declines
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; n int;
BEGIN
  cre := mk_user('pe1_cre'); cand := mk_user('pe1_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  n := match_pass_offer(cand, oid);
  IF n <> 1 THEN RAISE EXCEPTION 'B: pass_offer expected 1, got %', n; END IF;

  -- offer → passed
  PERFORM 1 FROM offers WHERE id=oid AND status='passed' AND resolved_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'B: offer not resolved to passed'; END IF;

  -- queue_entries → offer_passed
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='offer_passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: queue_entries not offer_passed'; END IF;

  -- chat_thread closed
  PERFORM 1 FROM chat_threads WHERE offer_id=oid AND state='closed' AND revoked_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'B: chat_thread not closed'; END IF;

  -- offer_expiry job cancelled
  PERFORM 1 FROM jobs WHERE type='offer_expiry' AND dedup_key=oid::text AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: offer_expiry job not cancelled'; END IF;

  -- offer_passed notification dispatched to the HOST (fix04: the passer must
  -- not be notified of their own action — "they passed this time" is host copy)
  PERFORM 1 FROM notifications WHERE user_id=cre AND type='offer_passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: offer_passed notification not dispatched to host'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=cand AND type='offer_passed';
  IF FOUND THEN RAISE EXCEPTION 'B: offer_passed must not notify the passer'; END IF;

  -- replay pass on already-passed → no-op (returns 0)
  IF match_pass_offer(cand, oid) <> 0 THEN
    RAISE EXCEPTION 'B: pass replay should return 0';
  END IF;

  RAISE NOTICE 'B: pass_offer + notification + chat-close + job-cancel + idempotency OK';
  ROLLBACK;
END $$;

-- expire_offer: simulate the offer_expiry job firing
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; n int;
BEGIN
  cre := mk_user('pe2_cre'); cand := mk_user('pe2_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- Job runner would call this (no auth context); we call directly as postgres (DEFINER bypasses auth check inside)
  n := match_expire_offer(oid);
  IF n <> 1 THEN RAISE EXCEPTION 'B: expire_offer expected 1, got %', n; END IF;

  PERFORM 1 FROM offers WHERE id=oid AND status='expired';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: offer not expired'; END IF;
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='offer_expired';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: queue_entries not offer_expired'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=cand AND type='offer_expired';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: offer_expired notification not dispatched'; END IF;

  RAISE NOTICE 'B: expire_offer + offer_expired notification OK';
  ROLLBACK;
END $$;

-- withdraw with active offer: resolves negative + notifies creator
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid;
BEGIN
  cre := mk_user('w1_cre'); cand := mk_user('w1_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM match_withdraw(cand, inst);

  -- offer resolved to passed (withdraw treats as decline)
  PERFORM 1 FROM offers WHERE id=oid AND status='passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: withdraw should resolve offer to passed'; END IF;

  -- offer_withdrawn notification to creator
  PERFORM 1 FROM notifications WHERE user_id=cre AND type='offer_withdrawn';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: offer_withdrawn notification not dispatched to creator'; END IF;

  RAISE NOTICE 'B: withdraw with active offer OK';
  ROLLBACK;
END $$;

-- withdraw without active offer (just shortlisted): queue → offer_passed
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid;
BEGIN
  cre := mk_user('w2_cre'); cand := mk_user('w2_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  -- No offer made; candidate withdraws while just shortlisted

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM match_withdraw(cand, inst);

  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='offer_passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'B: withdraw without offer should set queue_entries to offer_passed'; END IF;

  RAISE NOTICE 'B: withdraw without active offer OK';
  ROLLBACK;
END $$;
