-- supabase/tests/m3_update_itinerary_stops.sql
-- M3: owner-scoped validated itinerary edit RPC.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE owner_id uuid; other uuid; itin uuid; n int; got jsonb;
BEGIN
  owner_id := mk_user('m3_owner'); other := mk_user('m3_other');
  itin := mk_itinerary(owner_id);

  -- owner edits: valid stops + title persist
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_itinerary_stops(
    itin,
    '[{"place_id":"p1","place_name":"clay studio","start_time":"18:00","duration_min":90,"estimated_cost_pp":35}]'::jsonb,
    'pottery + ramen', 'low-key, hands dirty', 'https://img/cover.jpg');
  RESET ROLE;
  SELECT stops INTO got FROM itineraries WHERE id=itin;  -- (deviation) plan's 2-col INTO 1 scalar was invalid SQL; got is unused, narrowed to stops jsonb
  SELECT count(*) INTO n FROM itineraries WHERE id=itin AND title='pottery + ramen'
    AND cover_image_url='https://img/cover.jpg' AND jsonb_array_length(stops)=1;
  IF n<>1 THEN RAISE EXCEPTION 'M3.1a: owner edit did not persist (n=%)', n; END IF;
  RAISE NOTICE 'M3.1a: owner edit persists OK';

  -- non-owner is blocked
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_itinerary_stops(itin, '[{"place_id":"x","place_name":"sneaky","start_time":"1","duration_min":1,"estimated_cost_pp":1}]'::jsonb, null, null, null);
    RESET ROLE; RAISE EXCEPTION 'M3.1b: non-owner edit should have raised';
  EXCEPTION WHEN sqlstate '42501' THEN RESET ROLE; RAISE NOTICE 'M3.1b: non-owner blocked OK';
  END;

  -- empty stops array is rejected
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_itinerary_stops(itin, '[]'::jsonb, null, null, null);
    RESET ROLE; RAISE EXCEPTION 'M3.1c: empty stops should have raised';
  EXCEPTION WHEN sqlstate 'P0001' THEN RESET ROLE; RAISE NOTICE 'M3.1c: empty stops rejected OK';
  END;

  -- a stop missing place_name is rejected
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_itinerary_stops(itin, '[{"place_id":"x","start_time":"1","duration_min":1,"estimated_cost_pp":1}]'::jsonb, null, null, null);
    RESET ROLE; RAISE EXCEPTION 'M3.1d: missing place_name should have raised';
  EXCEPTION WHEN sqlstate 'P0001' THEN RESET ROLE; RAISE NOTICE 'M3.1d: invalid stop rejected OK';
  END;

  -- anon must NOT have execute
  IF has_function_privilege('anon','update_itinerary_stops(uuid, jsonb, text, text, text)','execute') THEN
    RAISE EXCEPTION 'M3.1e: anon should NOT execute update_itinerary_stops';
  END IF;
  RAISE NOTICE 'M3.1e: anon execute revoked OK';

  RAISE NOTICE 'M3.1: update_itinerary_stops OK';
  ROLLBACK;
END $$;
