-- supabase/tests/drft01_draft_lifecycle.sql
-- DRFT-01: delete_draft_itinerary deletes only the owner's NEVER-POSTED draft
-- (refuses a posted itinerary, refuses a non-owner), and clone_itinerary_as_draft
-- copies an owned itinerary into a fresh private un-posted draft owned by the
-- caller, leaving the source intact. Both revoke anon EXECUTE.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE
  owner_id uuid; other uuid;
  draft uuid; posted uuid; inst uuid; src uuid; clone uuid;
  n int; v_public boolean; v_user uuid;
BEGIN
  owner_id := mk_user('drft_owner'); other := mk_user('drft_other');

  -- ── delete ──────────────────────────────────────────────────────────
  -- owner deletes their own never-posted draft
  draft := mk_itinerary(owner_id);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM delete_draft_itinerary(draft);
  RESET ROLE;
  SELECT count(*) INTO n FROM itineraries WHERE id = draft;
  IF n <> 0 THEN RAISE EXCEPTION 'DRFT.1a: owner draft was not deleted (n=%)', n; END IF;
  RAISE NOTICE 'DRFT.1a: owner deletes own draft OK';

  -- a different user cannot delete the owner's draft (42501), row survives
  draft := mk_itinerary(owner_id);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM delete_draft_itinerary(draft);
    RESET ROLE; RAISE EXCEPTION 'DRFT.1b: non-owner delete should have raised';
  EXCEPTION WHEN sqlstate '42501' THEN RESET ROLE; RAISE NOTICE 'DRFT.1b: non-owner blocked OK';
  END;
  SELECT count(*) INTO n FROM itineraries WHERE id = draft;
  IF n <> 1 THEN RAISE EXCEPTION 'DRFT.1b: draft should still exist after blocked delete'; END IF;

  -- a POSTED itinerary (has a date_instance) is not a draft → P0001, row survives
  posted := mk_itinerary(owner_id);
  inst := mk_instance(posted, owner_id, now() + interval '2 days');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM delete_draft_itinerary(posted);
    RESET ROLE; RAISE EXCEPTION 'DRFT.1c: deleting a posted itinerary should have raised';
  EXCEPTION WHEN sqlstate 'P0001' THEN RESET ROLE; RAISE NOTICE 'DRFT.1c: posted-night guard OK';
  END;
  SELECT count(*) INTO n FROM itineraries WHERE id = posted;
  IF n <> 1 THEN RAISE EXCEPTION 'DRFT.1c: posted itinerary must survive the refused delete'; END IF;

  -- unknown id → P0002
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM delete_draft_itinerary(gen_random_uuid());
    RESET ROLE; RAISE EXCEPTION 'DRFT.1d: deleting an unknown draft should have raised';
  EXCEPTION WHEN sqlstate 'P0002' THEN RESET ROLE; RAISE NOTICE 'DRFT.1d: unknown-id guard OK';
  END;

  -- anon must NOT have execute
  IF has_function_privilege('anon','delete_draft_itinerary(uuid)','execute') THEN
    RAISE EXCEPTION 'DRFT.1e: anon should NOT execute delete_draft_itinerary';
  END IF;
  RAISE NOTICE 'DRFT.1e: anon execute revoked OK';

  -- ── clone ───────────────────────────────────────────────────────────
  -- owner clones their own itinerary into a fresh, private, un-posted draft
  src := mk_itinerary(owner_id);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  clone := clone_itinerary_as_draft(src);
  RESET ROLE;
  IF clone IS NULL OR clone = src THEN RAISE EXCEPTION 'DRFT.2a: clone must return a NEW id'; END IF;
  SELECT is_public, user_id INTO v_public, v_user FROM itineraries WHERE id = clone;
  IF v_user <> owner_id OR v_public <> false THEN
    RAISE EXCEPTION 'DRFT.2a: clone not owned/private (user=%, public=%)', v_user, v_public;
  END IF;
  SELECT count(*) INTO n FROM date_instances WHERE itinerary_id = clone;
  IF n <> 0 THEN RAISE EXCEPTION 'DRFT.2a: clone must be un-posted'; END IF;
  SELECT count(*) INTO n FROM itineraries WHERE id = src;
  IF n <> 1 THEN RAISE EXCEPTION 'DRFT.2a: source must be left intact'; END IF;
  RAISE NOTICE 'DRFT.2a: owner clones into a fresh draft OK';

  -- a different user cannot clone the owner's itinerary (P0002), no row created
  SELECT count(*) INTO n FROM itineraries WHERE user_id = other;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    clone := clone_itinerary_as_draft(src);
    RESET ROLE; RAISE EXCEPTION 'DRFT.2b: non-owner clone should have raised';
  EXCEPTION WHEN sqlstate 'P0002' THEN RESET ROLE; RAISE NOTICE 'DRFT.2b: non-owner clone blocked OK';
  END;
  SELECT count(*) INTO n FROM itineraries WHERE user_id = other;
  IF n <> 0 THEN RAISE EXCEPTION 'DRFT.2b: non-owner clone must not create a row'; END IF;

  -- anon must NOT have execute
  IF has_function_privilege('anon','clone_itinerary_as_draft(uuid)','execute') THEN
    RAISE EXCEPTION 'DRFT.2c: anon should NOT execute clone_itinerary_as_draft';
  END IF;
  RAISE NOTICE 'DRFT.2c: anon execute revoked OK';

  RAISE NOTICE 'DRFT.1/2: draft delete + clone lifecycle OK';
  ROLLBACK;
END $$;
