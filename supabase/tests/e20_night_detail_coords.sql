-- supabase/tests/e20_night_detail_coords.sql
-- E20 (07-01): get_night_detail widens each stop with the catalog venue's
-- lat/lng/place_slug (migration 20260606140000) so the detail sheet can render a real
-- Mapbox route and post-lock surfaces can deep-link /places/[slug].
--
-- Verifies (the <behavior> block of Task 2):
--   1. CATALOG stop  → non-null lat, lng, place_slug (merged from `places` by place_id).
--   2. NON-CATALOG stop (place_id absent from `places`) → lat/lng/place_slug = null AND
--      the call still succeeds (graceful degrade, D-01 — no row error).
--   3. reservation_url stays scrubbed from every stop element (m5 blind contract held).
--   4. anon CANNOT execute get_night_detail; authenticated CAN.
\i supabase/tests/_fixtures.sql

-- An itinerary with two stops: one catalog (carries a real place_id) and one
-- non-catalog (a random place_id absent from `places`). Both carry reservation_url so
-- the scrub assertion is meaningful.
create or replace function mk_itinerary_e20(p_user uuid, p_catalog_place uuid)
returns uuid language plpgsql as $$
declare iid uuid;
begin
  insert into itineraries (id, user_id, inputs, stops)
  values (
    gen_random_uuid(), p_user, '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'place_id', p_catalog_place::text, 'place_name','rooftop bar',
        'place_type','cocktail_bar', 'estimated_cost_pp', 22,
        'reservation_url','https://example.com/host-personal-link'),
      jsonb_build_object(
        'place_id', gen_random_uuid()::text, 'place_name','freeform spot',
        'place_type','walk', 'estimated_cost_pp', 0,
        'reservation_url','https://example.com/another-link')
    )
  ) returning id into iid;
  return iid;
end $$;

DO $$
DECLARE
  cre uuid; viewer uuid; place uuid; itin uuid; inst uuid;
  catalog_stop jsonb; noncat_stop jsonb; r record; nrows int;
BEGIN
  cre    := mk_user('e20_host');
  viewer := mk_user('e20_viewer');   -- a different authed user (RPC excludes the creator)

  -- Age gate: dating_enabled requires a birthdate in profiles_private.
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(viewer,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';

  -- Host must pass the eligibility gates the RPC enforces.
  update profiles
     set dating_enabled = true, verification = 'verified',
         account_state = 'active', standing = 'good',
         email = id::text || '@test.local'
   where id in (cre, viewer);

  -- A real catalog venue with known coords + slug.
  place := gen_random_uuid();
  insert into places (id, name, slug, neighborhood, drive_cluster, type, lat, lng)
  values (place, 'Rooftop Bar', 'e20-rooftop-bar', 'downtown', 'core',
          'cocktail_bar', 49.888000, -119.496000);

  itin := mk_itinerary_e20(cre, place);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- Drive get_night_detail AS the viewer.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', viewer::text)::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO nrows FROM get_night_detail(inst);
  IF nrows <> 1 THEN
    RAISE EXCEPTION 'E20 case 0: get_night_detail should return exactly 1 row (saw %)', nrows;
  END IF;

  SELECT stops->0, stops->1 INTO catalog_stop, noncat_stop FROM get_night_detail(inst);
  RESET ROLE;

  -- CASE 1: catalog stop carries non-null coords + slug.
  IF (catalog_stop->>'lat') IS NULL OR (catalog_stop->>'lng') IS NULL
     OR (catalog_stop->>'place_slug') IS NULL THEN
    RAISE EXCEPTION 'E20 case 1: catalog stop must carry lat/lng/place_slug (got lat=% lng=% slug=%)',
      catalog_stop->>'lat', catalog_stop->>'lng', catalog_stop->>'place_slug';
  END IF;
  IF (catalog_stop->>'place_slug') <> 'e20-rooftop-bar' THEN
    RAISE EXCEPTION 'E20 case 1: catalog place_slug mismatch (got %)', catalog_stop->>'place_slug';
  END IF;
  IF round((catalog_stop->>'lat')::numeric, 6) <> 49.888000
     OR round((catalog_stop->>'lng')::numeric, 6) <> -119.496000 THEN
    RAISE EXCEPTION 'E20 case 1: catalog coords mismatch (got lat=% lng=%)',
      catalog_stop->>'lat', catalog_stop->>'lng';
  END IF;
  RAISE NOTICE 'E20 case 1: catalog stop coords + slug OK';

  -- CASE 2: non-catalog stop degrades to null (no row error — we got here).
  IF (noncat_stop->>'lat') IS NOT NULL OR (noncat_stop->>'lng') IS NOT NULL
     OR (noncat_stop->>'place_slug') IS NOT NULL THEN
    RAISE EXCEPTION 'E20 case 2: non-catalog stop must degrade to null (got lat=% lng=% slug=%)',
      noncat_stop->>'lat', noncat_stop->>'lng', noncat_stop->>'place_slug';
  END IF;
  -- The non-catalog element must still exist (graceful degrade, not dropped).
  IF noncat_stop IS NULL THEN
    RAISE EXCEPTION 'E20 case 2: non-catalog stop element must still be present';
  END IF;
  RAISE NOTICE 'E20 case 2: non-catalog stop degraded to null, call succeeded OK';

  -- CASE 3: reservation_url scrubbed from BOTH stops (blind contract).
  IF (catalog_stop ? 'reservation_url') OR (noncat_stop ? 'reservation_url') THEN
    RAISE EXCEPTION 'E20 case 3: reservation_url must be scrubbed from every stop';
  END IF;
  RAISE NOTICE 'E20 case 3: reservation_url scrubbed OK';

  RAISE NOTICE 'E20: per-stop coords/slug + graceful degrade + scrub OK';
  ROLLBACK;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 4: privilege boundary — anon revoked, authenticated granted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE anon_ok boolean; auth_ok boolean;
BEGIN
  SELECT has_function_privilege('anon', 'get_night_detail(uuid)', 'EXECUTE') INTO anon_ok;
  SELECT has_function_privilege('authenticated', 'get_night_detail(uuid)', 'EXECUTE') INTO auth_ok;
  IF anon_ok THEN
    RAISE EXCEPTION 'E20 case 4: anon must NOT have EXECUTE on get_night_detail';
  END IF;
  IF NOT auth_ok THEN
    RAISE EXCEPTION 'E20 case 4: authenticated MUST have EXECUTE on get_night_detail';
  END IF;
  RAISE NOTICE 'E20 case 4: anon denied, authenticated granted OK';
END $$;
