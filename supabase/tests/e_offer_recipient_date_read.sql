-- supabase/tests/e_offer_recipient_date_read.sql
-- 5b-E: date_instances_select_offer_recipient RLS policy — offer recipient reads the date.
-- Verifies:
--   POSITIVE: a candidate with an ACTIVE offer on an instance CAN SELECT that date_instances row.
--   POSITIVE: still readable when the offer is 'accepted' (and post-lock, as a lock participant).
--   NEGATIVE: a random authenticated user (no offer) CANNOT read the instance.
--   NEGATIVE: a candidate with only an 'interested' queue_entry (no offer) CANNOT read it
--             (scope is offer-stage; interested candidates browse via the feed, not this policy).
--   REGRESSION: creator-read still works (no regression on 120200/120300).
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- ---------------------------------------------------------------------------
-- POSITIVE (active offer) + NEGATIVE (stranger, interested-only) + creator regression
-- ---------------------------------------------------------------------------
DO $$
DECLARE cre uuid; cand uuid; c_int uuid; stranger uuid;
  itin uuid; inst uuid; oid uuid; vis int;
BEGIN
  cre      := mk_user('e_host');
  cand     := mk_user('e_cand');       -- will receive an active offer
  c_int    := mk_user('e_interested');  -- right-swiped only, status='interested', NO offer
  stranger := mk_user('e_stranger');    -- unrelated authenticated user
  insert into profiles_private(user_id, birthdate) values
    (cre,'1990-01-01'),(cand,'1990-01-01'),(c_int,'1990-01-01'),(stranger,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, email=id::text||'@test.local'
    where id in (cre, cand, c_int, stranger);

  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- both candidates right-swipe -> queue_entries 'interested'
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values
    (cand,  inst, cre, 'right'),
    (c_int, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- host shortlists + offers ONLY cand. c_int stays 'interested' (no offer).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- POSITIVE: the offer recipient can read the offered instance (active offer).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'E case 1: offer recipient should read offered instance via ACTIVE offer (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'E case 1: offer recipient reads instance via active offer OK';

  -- columns actually read back (not just row count)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM starts_at, city_id, status FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E case 1b: offer recipient should read instance columns';
  END IF;
  RAISE NOTICE 'E case 1b: instance columns readable OK';

  -- NEGATIVE: a stranger (no offer, no relationship) cannot read the instance.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 0 THEN
    RAISE EXCEPTION 'E case 2: stranger must NOT read the instance (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'E case 2: stranger excluded OK';

  -- NEGATIVE: an 'interested'-only candidate (no offer) cannot read the instance via this policy.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c_int::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 0 THEN
    RAISE EXCEPTION 'E case 3: interested-only candidate must NOT read the instance (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'E case 3: interested-only candidate excluded (offer-stage scope) OK';

  -- REGRESSION: the creator still reads their own instance (120200/120300 untouched).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'E case 4: creator should still read own instance (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'E case 4: creator-read regression-free OK';

  RAISE NOTICE 'E: date_instances_select_offer_recipient (active offer) 4 cases OK';
  ROLLBACK;
END $$;

-- ---------------------------------------------------------------------------
-- POSITIVE (accepted offer / post-lock): the recipient still reads the instance after accept.
-- ---------------------------------------------------------------------------
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; lid uuid; vis int;
BEGIN
  cre  := mk_user('e2_host');
  cand := mk_user('e2_cand');
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

  -- candidate accepts -> offer becomes 'accepted', lock + lock_participants created.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  lid := match_accept_offer(cand, oid, gen_random_uuid());
  PERFORM 1 FROM offers WHERE id=oid AND status='accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'E case 5 setup: offer not in accepted state'; END IF;

  -- POSITIVE: recipient still reads the instance post-accept (accepted offer + lock participant).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'E case 5: recipient should read instance with ACCEPTED offer / post-lock (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'E case 5: recipient reads instance via accepted offer + lock participant OK';

  -- helper direct checks: true for the offer/lock party, false for an unrelated id.
  IF match_offer_recipient_can_see_instance(cand, inst) IS NOT TRUE THEN
    RAISE EXCEPTION 'E case 6: helper should return true for the accepted/locked recipient';
  END IF;
  IF match_offer_recipient_can_see_instance(gen_random_uuid(), inst) IS NOT FALSE THEN
    RAISE EXCEPTION 'E case 6: helper must return false for an unrelated viewer';
  END IF;
  RAISE NOTICE 'E case 6: helper truth-table OK';

  RAISE NOTICE 'E: date_instances_select_offer_recipient (accepted/post-lock) 2 cases OK';
  ROLLBACK;
END $$;
