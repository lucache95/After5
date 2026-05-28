-- supabase/tests/a_s5_swipe_hook.sql
-- A.8: right-swipe via record_swipe inserts queue_entries (match_ingest_interest hook).
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Right-swipe with match_v2_enabled=true → queue_entries seeded
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; q_count int;
BEGIN
  cre := mk_user('sh1_cre'); cand := mk_user('sh1_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- Candidate right-swipes via record_swipe (simulating S5's flow)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM record_swipe(inst, 'right'::swipe_direction);

  -- swipes row inserted
  PERFORM 1 FROM swipes WHERE swiper_id=cand AND date_instance_id=inst AND direction='right';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.8: swipes row not inserted'; END IF;

  -- queue_entries row inserted via match_ingest_interest hook
  SELECT count(*) INTO q_count FROM queue_entries
    WHERE date_instance_id=inst AND candidate_id=cand AND status='interested';
  IF q_count <> 1 THEN
    RAISE EXCEPTION 'A.8: queue_entries hook should produce 1 row; got %', q_count;
  END IF;

  RAISE NOTICE 'A.8: right-swipe → queue_entries hook OK';
  ROLLBACK;
END $$;

-- Left-swipe does NOT trigger ingest
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; q_count int;
BEGIN
  cre := mk_user('sh2_cre'); cand := mk_user('sh2_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM record_swipe(inst, 'left'::swipe_direction);

  SELECT count(*) INTO q_count FROM queue_entries
    WHERE date_instance_id=inst AND candidate_id=cand;
  IF q_count <> 0 THEN
    RAISE EXCEPTION 'A.8: left-swipe should NOT trigger queue_entries hook; got % rows', q_count;
  END IF;

  RAISE NOTICE 'A.8: left-swipe NO queue_entries OK';
  ROLLBACK;
END $$;

-- Feature flag OFF: right-swipe does NOT trigger hook (legacy mode preserved)
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; q_count int;
BEGIN
  update feature_config set value='false'::jsonb where key='match_v2_enabled';
  cre := mk_user('sh3_cre'); cand := mk_user('sh3_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  PERFORM record_swipe(inst, 'right'::swipe_direction);

  -- swipe still recorded (legacy works fine)
  PERFORM 1 FROM swipes WHERE swiper_id=cand AND date_instance_id=inst AND direction='right';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.8: swipes row not inserted even with flag off'; END IF;

  -- queue_entries should NOT be populated when flag is off
  SELECT count(*) INTO q_count FROM queue_entries
    WHERE date_instance_id=inst AND candidate_id=cand;
  IF q_count <> 0 THEN
    RAISE EXCEPTION 'A.8: flag-off right-swipe should NOT trigger hook; got % rows', q_count;
  END IF;

  RAISE NOTICE 'A.8: flag-off right-swipe NO queue_entries OK';
  ROLLBACK;
END $$;
