-- supabase/tests/e11_targeting.sql
-- E11 (REQ-E11) + E12 enum (REQ-E12): targeting persistence on date_instances via
-- the extended post_night; pay_setting + vibe_tags setters on the extended
-- update_itinerary_stops; passed_by_host present in queue_status; and anon EXECUTE
-- revoked on both re-emitted signatures. Mirrors s5_post_night.sql + m3_update_
-- itinerary_stops.sql harness (\i _fixtures.sql, jwt-claims, SET LOCAL ROLE, ROLLBACK).
\i supabase/tests/_fixtures.sql

-- ── 1. post_night persists targeting onto the date_instances row ─────────────
DO $do$
DECLARE cre uuid; mine uuid; inst uuid; n int;
BEGIN
  cre := mk_user('e11_cre');
  insert into profiles_private (user_id, birthdate) values (cre, current_date - interval '25 years')
    on conflict (user_id) do update set birthdate = current_date - interval '25 years';
  update profiles set dating_enabled=true, verification='verified',
    primary_city_id=(select id from cities where slug='kelowna')
  where id=cre;
  mine := mk_itinerary(cre);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);

  -- positional: p_itinerary, p_starts_at, p_venue, p_duration_min, p_ambient_sound_id,
  --             p_target_genders, p_target_age_range, p_search_radius_km
  inst := post_night(mine, now()+interval '5 days', null, 150, null,
                     array['women','nonbinary']::text[], int4range(25,40), 12.5::numeric);
  reset role;

  SELECT count(*) INTO n FROM date_instances
   WHERE id=inst
     AND target_genders = array['women','nonbinary']::text[]
     AND target_age_range = int4range(25,40)
     AND search_radius_km = 12.5;
  IF n<>1 THEN RAISE EXCEPTION 'E11.1: post_night did not persist targeting onto date_instances (n=%)', n; END IF;
  RAISE NOTICE 'E11.1: post_night targeting persists OK';
  ROLLBACK;
END $do$;

-- ── 2. post_night defaults leave targeting open/unbounded when omitted ────────
DO $do$
DECLARE cre uuid; mine uuid; inst uuid; n int;
BEGIN
  cre := mk_user('e11_def_cre');
  insert into profiles_private (user_id, birthdate) values (cre, current_date - interval '25 years')
    on conflict (user_id) do update set birthdate = current_date - interval '25 years';
  update profiles set dating_enabled=true, verification='verified',
    primary_city_id=(select id from cities where slug='kelowna')
  where id=cre;
  mine := mk_itinerary(cre);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);
  -- legacy 5-arg call shape still binds (defaults fill the targeting params)
  inst := post_night(mine, now()+interval '5 days', null, 150, null);
  reset role;

  SELECT count(*) INTO n FROM date_instances
   WHERE id=inst AND target_genders = '{}'::text[]
     AND target_age_range IS NULL AND search_radius_km IS NULL;
  IF n<>1 THEN RAISE EXCEPTION 'E11.2: omitted targeting should default open/unbounded (n=%)', n; END IF;
  RAISE NOTICE 'E11.2: post_night targeting defaults OK';
  ROLLBACK;
END $do$;

-- ── 3. update_itinerary_stops sets pay_setting + vibe_tags on the itinerary ───
DO $do$
DECLARE owner_id uuid; itin uuid; n int;
BEGIN
  owner_id := mk_user('e11_owner');
  itin := mk_itinerary(owner_id);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text, true);
  -- positional: p_itinerary, p_stops, p_title, p_why_note, p_cover_image_url,
  --             p_pay_setting, p_vibe_tags
  perform update_itinerary_stops(
    itin,
    '[{"place_id":"p1","place_name":"clay studio","start_time":"18:00","duration_min":90,"estimated_cost_pp":35}]'::jsonb,
    null, null, null,
    'i_pay', array['cozy','artsy']::text[]);
  reset role;

  SELECT count(*) INTO n FROM itineraries
   WHERE id=itin AND pay_setting='i_pay'::payment_preference
     AND vibe_tags = array['cozy','artsy']::text[];
  IF n<>1 THEN RAISE EXCEPTION 'E11.3: update_itinerary_stops did not set pay/vibe (n=%)', n; END IF;
  RAISE NOTICE 'E11.3: update_itinerary_stops pay/vibe setters OK';
  ROLLBACK;
END $do$;

-- ── 4. passed_by_host is a valid queue_status value ──────────────────────────
DO $do$
BEGIN
  PERFORM 'passed_by_host'::queue_status;  -- raises invalid_text_representation if absent
  RAISE NOTICE 'E11.4: queue_status includes passed_by_host OK';
END $do$;

-- ── 5. anon has NO execute on either re-emitted signature ─────────────────────
DO $do$
BEGIN
  IF has_function_privilege('anon',
       'post_night(uuid, timestamptz, uuid, integer, uuid, text[], int4range, numeric)','execute') THEN
    RAISE EXCEPTION 'E11.5: anon should NOT execute the extended post_night';
  END IF;
  IF has_function_privilege('anon',
       'update_itinerary_stops(uuid, jsonb, text, text, text, text, text[])','execute') THEN
    RAISE EXCEPTION 'E11.5: anon should NOT execute the extended update_itinerary_stops';
  END IF;
  RAISE NOTICE 'E11.5: anon execute revoked on both signatures OK';
END $do$;

-- ── 6. exactly ONE live signature per function (no stale overload) ────────────
DO $do$
DECLARE pn int; uis int;
BEGIN
  SELECT count(*) INTO pn  FROM pg_proc WHERE proname='post_night';
  SELECT count(*) INTO uis FROM pg_proc WHERE proname='update_itinerary_stops';
  IF pn  <> 1 THEN RAISE EXCEPTION 'E11.6: post_night must have exactly one signature (got %)', pn; END IF;
  IF uis <> 1 THEN RAISE EXCEPTION 'E11.6: update_itinerary_stops must have exactly one signature (got %)', uis; END IF;
  RAISE NOTICE 'E11.6: one live signature per function OK';
END $do$;
