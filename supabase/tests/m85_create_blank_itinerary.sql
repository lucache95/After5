-- supabase/tests/m85_create_blank_itinerary.sql
-- #85 door 2: create_blank_itinerary() makes exactly one owned, private, empty itinerary
-- for the caller, the row is editable by the owner via update_itinerary_stops and not by
-- others (RLS), and anon EXECUTE is revoked.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE owner_id uuid; other uuid; blank uuid; n int;
BEGIN
  owner_id := mk_user('m85_owner'); other := mk_user('m85_other');

  -- caller gets exactly one owned, private, single-stop itinerary
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  blank := create_blank_itinerary();
  RESET ROLE;

  SELECT count(*) INTO n FROM itineraries
    WHERE id = blank AND user_id = owner_id AND is_public = false
      AND title IS NULL AND jsonb_array_length(stops) = 1;
  IF n <> 1 THEN RAISE EXCEPTION 'M85.1a: blank itinerary not created as owned/private/single-stop (n=%)', n; END IF;
  RAISE NOTICE 'M85.1a: blank itinerary created OK';

  -- owner can edit the blank via update_itinerary_stops
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_itinerary_stops(
    blank,
    '[{"place_id":"p1","place_name":"clay studio","start_time":"18:00","duration_min":90,"estimated_cost_pp":35}]'::jsonb,
    'my night', null, null);
  RESET ROLE;
  SELECT count(*) INTO n FROM itineraries WHERE id = blank AND title = 'my night';
  IF n <> 1 THEN RAISE EXCEPTION 'M85.1b: owner could not edit the blank canvas'; END IF;
  RAISE NOTICE 'M85.1b: owner edits blank canvas OK';

  -- a different user cannot edit it (owner-scoped RPC)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_itinerary_stops(blank, '[{"place_id":"x","place_name":"sneaky","start_time":"1","duration_min":1,"estimated_cost_pp":1}]'::jsonb, null, null, null);
    RESET ROLE; RAISE EXCEPTION 'M85.1c: non-owner edit should have raised';
  EXCEPTION WHEN sqlstate '42501' THEN RESET ROLE; RAISE NOTICE 'M85.1c: non-owner blocked OK';
  END;

  -- anon must NOT have execute
  IF has_function_privilege('anon','create_blank_itinerary()','execute') THEN
    RAISE EXCEPTION 'M85.1d: anon should NOT execute create_blank_itinerary';
  END IF;
  RAISE NOTICE 'M85.1d: anon execute revoked OK';

  RAISE NOTICE 'M85.1: create_blank_itinerary OK';
  ROLLBACK;
END $$;
