-- supabase/tests/m6_profile_photos_rls.sql
-- M6: reveal-gating on the multi-photo gallery — the load-bearing security property.
-- A user's CLEAR photos must stay hidden from everyone until a reveal relationship
-- (active offer / lock) exists. Verifies, for BOTH the profile_photos table policy
-- AND the storage.objects clear-read policy:
--   1. owner can read their own gallery rows + clear objects
--   2. a stranger (no offer/lock) gets ZERO gallery rows and CANNOT read the clear object,
--      but CAN read the broadly-readable blurred object (blind feed)
--   3. once an active offer exists, the counterparty CAN read the gallery row + clear object
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

DO $$
DECLARE owner_id uuid; cand uuid; stranger uuid; itin uuid; inst uuid; oid uuid;
  clear_name text; blurred_name text; n int;
BEGIN
  owner_id := mk_user('pp_owner'); cand := mk_user('pp_cand'); stranger := mk_user('pp_stranger');
  insert into profiles_private(user_id, birthdate)
    values (owner_id,'1990-01-01'),(cand,'1990-01-01'),(stranger,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, email=id::text||'@test.local'
    where id in (owner_id, cand, stranger);
  itin := mk_itinerary(owner_id);
  inst := mk_instance(itin, owner_id, now() + interval '2 days');

  clear_name   := owner_id::text || '/photo1.jpg';
  blurred_name := owner_id::text || '/photo1_blurred.jpg';

  -- Seed the owner's primary gallery photo + backing storage objects (superuser; RLS-bypass for setup).
  insert into profile_photos(user_id, clear_path, blurred_path, sort_order, is_primary)
    values (owner_id, clear_name, blurred_name, 0, true);
  insert into storage.objects(bucket_id, name, owner)
    values ('profile-photos', clear_name, owner_id),
           ('profile-photos', blurred_name, owner_id)
    on conflict do nothing;

  ---------------------------------------------------------------------------
  -- CASE 1: owner reads own gallery row + clear object
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM profile_photos WHERE user_id = owner_id;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'M6 case 1a: owner should see own gallery row (saw %)', n; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='profile-photos' AND name = clear_name;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'M6 case 1b: owner should read own clear object (saw %)', n; END IF;
  RAISE NOTICE 'M6 case 1: owner reads own gallery + clear object OK';

  ---------------------------------------------------------------------------
  -- CASE 2: stranger (no relationship) sees NOTHING clear — row + clear object both denied
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM profile_photos WHERE user_id = owner_id;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'M6 case 2a: stranger must NOT see owner gallery row (saw %)', n; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='profile-photos' AND name = clear_name;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'M6 case 2b: stranger must NOT read owner CLEAR object (saw %)', n; END IF;

  -- the BLURRED object IS broadly readable to any authenticated user (blind feed)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='profile-photos' AND name = blurred_name;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'M6 case 2c: blurred object should be readable to authenticated (saw %)', n; END IF;
  RAISE NOTICE 'M6 case 2: stranger blocked from clear (row + object), blurred allowed OK';

  ---------------------------------------------------------------------------
  -- Establish an active offer between owner (creator) and cand.
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, owner_id, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true);
  PERFORM match_shortlist(owner_id, inst, cand, 1);
  oid := (match_make_offer(owner_id, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  ---------------------------------------------------------------------------
  -- CASE 3: candidate in active offer CAN read owner's gallery row + clear object
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM profile_photos WHERE user_id = owner_id;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'M6 case 3a: candidate-in-offer should see owner gallery row (saw %)', n; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='profile-photos' AND name = clear_name;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'M6 case 3b: candidate-in-offer should read owner CLEAR object (saw %)', n; END IF;
  RAISE NOTICE 'M6 case 3: candidate-in-offer reads owner gallery + clear object OK';

  RAISE NOTICE 'M6: profile_photos reveal-gating (table + storage) 3 cases OK';
  ROLLBACK;
END $$;
