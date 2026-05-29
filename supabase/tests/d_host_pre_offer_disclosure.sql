-- supabase/tests/d_host_pre_offer_disclosure.sql
-- 5b-D: profiles_select_host_queue RLS policy — host reads PRE-OFFER candidate Tier-3.
-- Verifies:
--   POSITIVE: creator CAN SELECT a candidate's profile when that candidate has an
--             interested / shortlisted queue_entry on the creator's own instance.
--   NEGATIVE: a random authenticated user (no relationship) CANNOT read that profile.
--   NEGATIVE: the creator CANNOT read a profile that has NO queue_entry on their instance.
--   REGRESSION: a candidate with NO queue row on this instance stays hidden; offer/lock
--               reveal (126600) is exercised separately by a_revealed_rls_negative.sql.
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- ---------------------------------------------------------------------------
-- POSITIVE + NEGATIVE (interested/shortlisted candidates on the host's instance)
-- ---------------------------------------------------------------------------
DO $$
DECLARE cre uuid; c_int uuid; c_short uuid; c_none uuid; stranger uuid;
  itin uuid; inst uuid; vis int;
BEGIN
  cre      := mk_user('d_host');
  c_int    := mk_user('d_interested');   -- right-swiped, status='interested'
  c_short  := mk_user('d_shortlisted');  -- right-swiped + shortlisted
  c_none   := mk_user('d_noqueue');      -- enabled, but never swiped this instance
  stranger := mk_user('d_stranger');     -- unrelated authenticated user
  insert into profiles_private(user_id, birthdate) values
    (cre,'1990-01-01'),(c_int,'1990-01-01'),(c_short,'1990-01-01'),
    (c_none,'1990-01-01'),(stranger,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, email=id::text||'@test.local'
    where id in (cre, c_int, c_short, c_none, stranger);

  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- two candidates right-swipe the host's instance -> queue_entries 'interested'
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values
    (c_int,   inst, cre, 'right'),
    (c_short, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- host shortlists ONE of them (c_short). c_int stays 'interested'.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, c_short, 1);

  -- POSITIVE: as the creator, BOTH the interested and shortlisted candidates are visible.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM profiles WHERE id = c_int;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'D case 1: creator should see INTERESTED candidate Tier-3 (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'D case 1: creator sees interested candidate OK';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM profiles WHERE id = c_short;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'D case 2: creator should see SHORTLISTED candidate Tier-3 (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'D case 2: creator sees shortlisted candidate OK';

  -- Tier-3 columns actually read back (not just row count)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM first_name, age, clear_photo_url FROM profiles WHERE id = c_int;
  RESET ROLE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'D case 2b: creator should read interested candidate Tier-3 columns';
  END IF;
  RAISE NOTICE 'D case 2b: Tier-3 columns readable OK';

  -- NEGATIVE: a stranger (no relationship) CANNOT read the interested candidate.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM profiles WHERE id = c_int;
  RESET ROLE;
  IF vis <> 0 THEN
    RAISE EXCEPTION 'D case 3: stranger must NOT see a queued candidate (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'D case 3: stranger excluded OK';

  -- NEGATIVE: the creator CANNOT read a profile with NO queue_entry on their instance.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM profiles WHERE id = c_none;
  RESET ROLE;
  IF vis <> 0 THEN
    RAISE EXCEPTION 'D case 4: creator must NOT see a non-queued profile (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'D case 4: creator excluded from non-queued profile OK';

  -- NEGATIVE: the interested candidate is NOT the host; they should NOT gain host-grant
  -- access to OTHER candidates via this policy (they own no instance here).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c_int::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM profiles WHERE id = c_short;
  RESET ROLE;
  IF vis <> 0 THEN
    RAISE EXCEPTION 'D case 5: a candidate must NOT read another candidate via host policy (saw %)', vis;
  END IF;
  RAISE NOTICE 'D case 5: candidate cannot read co-candidate OK';

  RAISE NOTICE 'D: profiles_select_host_queue pre-offer RLS 5 cases OK';
  ROLLBACK;
END $$;

-- ---------------------------------------------------------------------------
-- REGRESSION: helper returns false for an instance the viewer does NOT own,
-- even if a queue row exists for that candidate elsewhere.
-- ---------------------------------------------------------------------------
DO $$
DECLARE cre uuid; other uuid; cand uuid; itin uuid; inst uuid;
BEGIN
  cre   := mk_user('d2_host');
  other := mk_user('d2_other');   -- a different creator
  cand  := mk_user('d2_cand');
  itin  := mk_itinerary(cre);
  inst  := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- cand is queued on cre's instance, NOT on other's. other must not be granted.
  IF match_host_can_see_candidate(cre, cand) IS NOT TRUE THEN
    RAISE EXCEPTION 'D case 6: owner cre should see queued candidate via helper';
  END IF;
  IF match_host_can_see_candidate(other, cand) IS NOT FALSE THEN
    RAISE EXCEPTION 'D case 6: non-owner other must NOT see candidate via helper';
  END IF;
  RAISE NOTICE 'D case 6: helper ownership scoping OK';
  ROLLBACK;
END $$;
