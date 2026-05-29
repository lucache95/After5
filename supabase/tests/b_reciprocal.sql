-- supabase/tests/b_reciprocal.sql
-- 5b reciprocal: end-to-end happy path for the reciprocal chooser (option b).
-- match_make_offer returns a discriminated jsonb: {kind:'offer',offer_id} on the
-- happy path, {kind:'reciprocal',pair_id} when a reciprocal is detected. The
-- reciprocal branch COMMITS a reciprocal_pairs row (no RAISE), so
-- match_resolve_reciprocal then has a pair to resolve into a single lock.
\i supabase/tests/_fixtures.sql

insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Full reciprocal happy path
DO $$
DECLARE
  alice uuid; bob uuid;
  itin_a uuid; itin_b uuid; inst_a uuid; inst_b uuid;
  res_a jsonb; res_b jsonb;
  v_pair_id uuid; lo uuid; hi uuid;
  lid uuid;
BEGIN
  alice := mk_user('rec_alice'); bob := mk_user('rec_bob');
  insert into profiles_private(user_id, birthdate)
    values (alice,'1990-01-01'),(bob,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (alice, bob);

  -- (1) Alice creates a seeking instance; Bob shortlisted on it.
  itin_a := mk_itinerary(alice);
  inst_a := mk_instance(itin_a, alice, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (bob, inst_a, alice, 'right');
  PERFORM match_ingest_interest(inst_a);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', alice::text)::text, true);
  PERFORM match_shortlist(alice, inst_a, bob, 1);

  -- (2) Alice makes an offer to Bob → kind='offer', offer active, no reciprocal yet.
  res_a := match_make_offer(alice, inst_a, bob, gen_random_uuid());
  IF res_a->>'kind' IS DISTINCT FROM 'offer' THEN
    RAISE EXCEPTION 'rec: Alice offer kind != offer (got %)', res_a;
  END IF;
  PERFORM 1 FROM offers WHERE date_instance_id=inst_a AND candidate_id=bob AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'rec: Alice offer not active'; END IF;
  IF EXISTS (SELECT 1 FROM reciprocal_pairs) THEN
    RAISE EXCEPTION 'rec: reciprocal_pairs should be empty before B offers';
  END IF;

  -- Bob creates his own seeking instance; Alice shortlisted on it.
  itin_b := mk_itinerary(bob);
  inst_b := mk_instance(itin_b, bob, now() + interval '3 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (alice, inst_b, bob, 'right');
  PERFORM match_ingest_interest(inst_b);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', bob::text)::text, true);
  PERFORM match_shortlist(bob, inst_b, alice, 1);

  -- (3) Bob makes an offer to Alice → kind='reciprocal' (NOT an error), pair committed.
  res_b := match_make_offer(bob, inst_b, alice, gen_random_uuid());
  IF res_b->>'kind' IS DISTINCT FROM 'reciprocal' THEN
    RAISE EXCEPTION 'rec: Bob offer must return kind=reciprocal (got %)', res_b;
  END IF;
  v_pair_id := (res_b->>'pair_id')::uuid;
  IF v_pair_id IS NULL THEN RAISE EXCEPTION 'rec: reciprocal return missing pair_id'; END IF;

  -- An open reciprocal_pairs row exists with ordered users, matching the returned id.
  lo := least(alice, bob); hi := greatest(alice, bob);
  PERFORM 1 FROM reciprocal_pairs
    WHERE id=v_pair_id AND low_user=lo AND high_user=hi AND status='open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rec: open reciprocal_pairs row not committed (id=%, low=%, high=%)', v_pair_id, lo, hi;
  END IF;

  -- Only Alice's offer exists; Bob's was never inserted (reciprocal returns before the offer insert).
  IF (SELECT count(*) FROM offers WHERE status='active' AND date_instance_id IN (inst_a, inst_b)) <> 1 THEN
    RAISE EXCEPTION 'rec: reciprocal should not create a second offer (count=%)',
      (SELECT count(*) FROM offers WHERE status='active' AND date_instance_id IN (inst_a, inst_b));
  END IF;

  RAISE NOTICE 'rec: reciprocal return {kind:reciprocal,pair_id} + committed reciprocal_pairs row OK';

  -- (4) Resolve: actor (Alice) chooses inst_a → a lock is created, pair flips to resolved.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', alice::text)::text, true);
  lid := match_resolve_reciprocal(alice, v_pair_id, inst_a, gen_random_uuid());
  IF lid IS NULL THEN RAISE EXCEPTION 'rec: resolve returned NULL lock'; END IF;

  PERFORM 1 FROM locks WHERE id=lid AND date_instance_id=inst_a AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'rec: lock row not created on chosen instance'; END IF;

  PERFORM 1 FROM reciprocal_pairs WHERE id=v_pair_id AND status='resolved' AND resolved_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'rec: pair status did not flip to resolved'; END IF;

  RAISE NOTICE 'rec: match_resolve_reciprocal creates lock + flips pair to resolved OK';
  ROLLBACK;
END $$;
