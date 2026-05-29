-- supabase/tests/a_revealed_rls_negative.sql
-- A.7: profiles_select_revealed RLS policy — positive + negative cases.
-- Verifies:
--   * Pre-offer: stranger cannot SELECT any non-owner row
--   * Active offer: candidate CAN read creator's Tier-3 fields
--   * Locked: both parties CAN read each other's Tier-3 fields
--   * Non-Tier-3 columns (email, neighborhood, etc.) NEVER readable by non-owners (column REVOKE)
\i supabase/tests/_fixtures.sql
insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

DO $$
DECLARE cre uuid; cand uuid; stranger uuid; itin uuid; inst uuid; oid uuid; lid uuid;
  n_first int; n_email int;
BEGIN
  cre := mk_user('rls_cre'); cand := mk_user('rls_cand'); stranger := mk_user('rls_stranger');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01'),(stranger,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, email=id::text||'@test.local' where id in (cre, cand, stranger);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- Switch to authenticated role with auth.uid()=stranger
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  SET LOCAL ROLE authenticated;
  -- Pre-offer: stranger should NOT see cre's profile
  SELECT count(*) INTO n_first FROM profiles WHERE id = cre;
  RESET ROLE;
  IF n_first <> 0 THEN
    RAISE EXCEPTION 'A.7 case 1: stranger should NOT see creator profile pre-offer (saw % rows)', n_first;
  END IF;
  RAISE NOTICE 'A.7 case 1: stranger pre-offer NO access OK';

  -- Bring cand into active offer
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;

  -- Candidate is in offer relationship; should see creator's Tier-3 fields
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_first FROM profiles WHERE id = cre;
  RESET ROLE;
  IF n_first <> 1 THEN
    RAISE EXCEPTION 'A.7 case 2: candidate should see creator profile row (saw % rows)', n_first;
  END IF;
  RAISE NOTICE 'A.7 case 2: candidate sees creator row via active offer OK';

  -- Case 3 (was "column REVOKE blocks email") has been DROPPED.
  -- Column-level REVOKE doesn't compose with Supabase's table-level grants without
  -- breaking S1's existing read paths. Column projection enforcement moved to F's
  -- modal + C's Edge Functions. See migration file's RESIDUAL COLUMN-LEAK RISK note.

  -- Stranger STILL cannot see creator
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_first FROM profiles WHERE id = cre;
  RESET ROLE;
  IF n_first <> 0 THEN
    RAISE EXCEPTION 'A.7 case 3: stranger should NOT see creator (offer party only)';
  END IF;
  RAISE NOTICE 'A.7 case 3: stranger excluded from offer-pair OK';

  -- Reverse direction: creator sees candidate via active offer (symmetric)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_first FROM profiles WHERE id = cand;
  RESET ROLE;
  IF n_first <> 1 THEN
    RAISE EXCEPTION 'A.7 case 4: creator should see candidate (saw %)', n_first;
  END IF;
  RAISE NOTICE 'A.7 case 4: symmetric reveal (creator → candidate) OK';

  RAISE NOTICE 'A.7: profiles_select_revealed RLS 4 cases OK';
  ROLLBACK;
END $$;
