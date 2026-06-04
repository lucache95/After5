-- supabase/tests/e13_plan_read.sql
-- E13 (03-05): the matched-plan SSR read path used by OfferDetail + LockDetail.
-- The offer/lock screens load the night's full itinerary in TWO RLS-bound steps:
--   1. read the date_instances row (offer recipient → date_instances_select_offer_recipient,
--      migration 127500) and its itinerary_id COLUMN;
--   2. read itineraries.stops BY that id (itineraries_readable_by_id USING(true),
--      migration 20260419202912).
-- This is the path the loaders use (NOT get_night_detail, which is blind/pre-swipe-only).
-- Verifies:
--   POSITIVE: an offer-recipient candidate CAN SELECT the date_instances row and read itinerary_id.
--   POSITIVE: reading itineraries by that id returns the forked stops (the plan).
--   NEGATIVE: a STRANGER (no offer / no relationship) CANNOT read the instance row (RLS deny).
--   REGRESSION: the creator still reads their own instance.
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- A 2-stop itinerary owned by p_user, so the by-id read returns a non-empty plan.
create or replace function mk_itinerary_with_stops(p_user uuid) returns uuid language plpgsql as $$
declare iid uuid;
begin
  insert into itineraries (id, user_id, inputs, stops)
  values (
    gen_random_uuid(), p_user, '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('name','rooftop bar','place_type','bar','estimated_cost_pp',22),
      jsonb_build_object('name','late-night ramen','place_type','restaurant','estimated_cost_pp',0)
    )
  ) returning id into iid;
  return iid;
end $$;

DO $$
DECLARE cre uuid; cand uuid; stranger uuid;
  itin uuid; inst uuid; oid uuid; vis int; iid uuid; nstops int;
BEGIN
  cre      := mk_user('e13_host');
  cand     := mk_user('e13_cand');      -- will receive an active offer
  stranger := mk_user('e13_stranger');  -- unrelated authenticated user
  insert into profiles_private(user_id, birthdate) values
    (cre,'1990-01-01'),(cand,'1990-01-01'),(stranger,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, email=id::text||'@test.local'
    where id in (cre, cand, stranger);

  itin := mk_itinerary_with_stops(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- candidate right-swipes -> queue_entries 'interested'
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values
    (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- host shortlists + offers cand.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- POSITIVE 1: the offer recipient reads the instance AND its itinerary_id column.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT itinerary_id INTO iid FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF iid IS NULL THEN
    RAISE EXCEPTION 'E13 case 1: offer recipient should read date_instances.itinerary_id (got NULL)';
  END IF;
  IF iid <> itin THEN
    RAISE EXCEPTION 'E13 case 1: itinerary_id mismatch (% vs %)', iid, itin;
  END IF;
  RAISE NOTICE 'E13 case 1: recipient reads instance + itinerary_id OK';

  -- POSITIVE 2: reading itineraries BY that id returns the forked stops (the plan).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT jsonb_array_length(stops) INTO nstops FROM itineraries WHERE id = iid;
  RESET ROLE;
  IF nstops IS NULL OR nstops < 2 THEN
    RAISE EXCEPTION 'E13 case 2: recipient should read the 2-stop plan via itineraries_readable_by_id (saw % stops)', nstops;
  END IF;
  RAISE NOTICE 'E13 case 2: recipient reads forked stops by id OK (% stops)', nstops;

  -- NEGATIVE: a stranger (no offer, no relationship) cannot read the instance row.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 0 THEN
    RAISE EXCEPTION 'E13 case 3: stranger must NOT read the instance (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'E13 case 3: stranger excluded from the instance OK';

  -- REGRESSION: the creator still reads their own instance.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO vis FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF vis <> 1 THEN
    RAISE EXCEPTION 'E13 case 4: creator should still read own instance (saw % rows)', vis;
  END IF;
  RAISE NOTICE 'E13 case 4: creator-read regression-free OK';

  RAISE NOTICE 'E13: matched-plan read path (recipient reads stops; stranger denied) OK';
  ROLLBACK;
END $$;

-- ---------------------------------------------------------------------------
-- POSITIVE (post-lock): a lock participant still reads the instance + stops.
-- ---------------------------------------------------------------------------
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; oid uuid; lid uuid;
  vis int; iid uuid; nstops int;
BEGIN
  cre  := mk_user('e13b_host');
  cand := mk_user('e13b_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary_with_stops(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- candidate accepts -> lock created; candidate is a lock participant.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  lid := match_accept_offer(cand, oid, gen_random_uuid());

  -- POSITIVE: lock participant reads the instance + itinerary_id post-lock.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT itinerary_id INTO iid FROM date_instances WHERE id = inst;
  RESET ROLE;
  IF iid IS NULL OR iid <> itin THEN
    RAISE EXCEPTION 'E13 case 5: lock participant should read instance + itinerary_id post-lock';
  END IF;

  -- ...and the stops by id.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT jsonb_array_length(stops) INTO nstops FROM itineraries WHERE id = iid;
  RESET ROLE;
  IF nstops IS NULL OR nstops < 2 THEN
    RAISE EXCEPTION 'E13 case 5: lock participant should read the 2-stop plan post-lock (saw % stops)', nstops;
  END IF;
  RAISE NOTICE 'E13 case 5: lock participant reads instance + forked stops post-lock OK';

  ROLLBACK;
END $$;
