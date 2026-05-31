-- supabase/tests/f_match_cohort_allowlist.sql
-- F: cohort allowlist gate. With the GLOBAL match_v2_enabled flag = false:
--   - a user in match_cohort CAN shortlist/make_offer (no P5000)
--   - a user NOT in match_cohort still gets P5000
--   - app_match_enabled(cohort_user)=true, (random)=false, (null)=false
\i supabase/tests/_fixtures.sql

-- GLOBAL flag explicitly OFF for the whole file (cohort is the only thing that opens the gate).
insert into feature_config(key, value) values ('match_v2_enabled', 'false'::jsonb)
  on conflict (key) do update set value='false'::jsonb;

-- F.1: app_match_enabled() truth table with global flag OFF -----------------
DO $$
DECLARE u uuid; r uuid := gen_random_uuid();
BEGIN
  update feature_config set value='false'::jsonb where key='match_v2_enabled';
  u := mk_user('coh_helper');
  insert into match_cohort(user_id) values (u);

  IF app_match_enabled(u) IS NOT TRUE THEN
    RAISE EXCEPTION 'F.1: app_match_enabled(cohort_user) must be true';
  END IF;
  IF app_match_enabled(r) IS NOT FALSE THEN
    RAISE EXCEPTION 'F.1: app_match_enabled(random_uuid) must be false';
  END IF;
  IF app_match_enabled(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'F.1: app_match_enabled(null) must be false';
  END IF;
  RAISE NOTICE 'F.1: app_match_enabled truth table OK';
  ROLLBACK;
END $$;

-- F.2: cohort user CAN shortlist + make_offer with global flag OFF ----------
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; res jsonb;
BEGIN
  update feature_config set value='false'::jsonb where key='match_v2_enabled';
  cre := mk_user('coh_cre'); cand := mk_user('coh_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  -- creator (the acting user for shortlist/make_offer) is in the cohort; flag stays OFF
  insert into match_cohort(user_id) values (cre);

  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);

  -- shortlist must NOT raise P5000 (cohort opens the gate)
  PERFORM match_shortlist(cre, inst, cand, 1);
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand AND status='shortlisted';
  IF NOT FOUND THEN RAISE EXCEPTION 'F.2: cohort creator should be able to shortlist with flag off'; END IF;

  -- make_offer must NOT raise P5000 either
  res := match_make_offer(cre, inst, cand, gen_random_uuid());
  IF res->>'kind' IS DISTINCT FROM 'offer' THEN
    RAISE EXCEPTION 'F.2: cohort creator make_offer should succeed (got %)', res;
  END IF;
  RAISE NOTICE 'F.2: cohort user shortlist+make_offer with flag OFF OK';
  ROLLBACK;
END $$;

-- F.3: NON-cohort user still gets P5000 with global flag OFF ----------------
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  update feature_config set value='false'::jsonb where key='match_v2_enabled';
  cre := mk_user('coh_no_cre'); cand := mk_user('coh_no_cand');
  insert into profiles_private(user_id, birthdate) values (cre, '1990-01-01'), (cand, '1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  -- cre is NOT in match_cohort
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);

  BEGIN
    PERFORM match_shortlist(cre, inst, cand, 1);
  EXCEPTION
    WHEN sqlstate 'P5000' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'F.3: expected P5000, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'F.3: non-cohort user with flag off must raise P5000'; END IF;
  RAISE NOTICE 'F.3: non-cohort user P5000 OK';
  ROLLBACK;
END $$;

-- F.4: empty-cohort + flag-off no-op invariant — app_match_enabled is false --
DO $$
DECLARE u uuid;
BEGIN
  update feature_config set value='false'::jsonb where key='match_v2_enabled';
  delete from match_cohort;  -- rolled back; just proves the empty-table baseline
  u := mk_user('coh_empty');
  IF app_match_enabled(u) IS NOT FALSE THEN
    RAISE EXCEPTION 'F.4: with flag off + empty cohort, app_match_enabled(any) must be false';
  END IF;
  RAISE NOTICE 'F.4: empty-cohort + flag-off no-op invariant OK';
  ROLLBACK;
END $$;
