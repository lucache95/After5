-- supabase/tests/m5_get_night_detail.sql
-- M5: get_night_detail(p_instance uuid) — blind-safe FULL date detail for the swiper.
-- Repo convention: plain `DO $$ ... RAISE EXCEPTION ... ROLLBACK` run via
-- `psql -v ON_ERROR_STOP=1 -f` (no pgTAP in this repo). Each assertion RAISEs on
-- failure; reaching the final NOTICE means all assertions passed.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE
  cre uuid; usr uuid; itin uuid; inst uuid; kel uuid;
  n bigint; v_title text; v_cost numeric; v_len int; v_name text;
  v_minute int; v_resv text; v_outcols int;
BEGIN
  select id into kel from cities where slug='kelowna';
  cre := mk_user('creator'); usr := mk_user('viewer');
  insert into profiles_private(user_id,birthdate) values (cre,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  insert into profiles_private(user_id,birthdate) values (usr,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['man'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, verification='verified', dating_enabled=true,
    account_state='active', standing='good' where id=cre;
  update profiles set gender='man', gender_preferences=array['woman'], age=32, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, verification='verified', dating_enabled=true,
    account_state='active', standing='good' where id=usr;

  -- A rich itinerary (generated shape) with an identifying-looking reservation_url to scrub.
  itin := mk_itinerary(cre);
  update itineraries set
    stops = '[{"place_name":"The Train Station Pub","place_type":"cocktail_bar","start_time":"19:00",
               "duration_min":90,"estimated_cost_pp":28,"what_to_do":"split the charcuterie",
               "neighborhood":"Downtown","lat":49.888,"lng":-119.496,"photo_url":"https://x/p.jpg",
               "local_insight":"ask for the corner booth","reservation_url":"https://secret-host-link"}]'::jsonb,
    title = 'late night downtown', hook = 'a slow burn', why_it_works = 'walkable, low-key, real',
    why_note = 'walkable and low-key', vibe_tags = array['cozy','nightlife']::text[],
    cover_image_url = 'https://x/cover.jpg', pay_setting = 'split',
    total_cost_pp = 56, total_duration_min = 180
    where id = itin;

  -- a future, seeking instance; approve it (mk_instance defaults moderation to pending).
  inst := mk_instance(itin, cre, now()+interval '3 days');
  update date_instances set moderation_status='approved' where id=inst;

  -- Impersonate the VIEWER (the candidate), not the creator.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);

  -- 1. function exists with signature get_night_detail(uuid)
  perform 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname='get_night_detail'
      and pg_get_function_identity_arguments(p.oid)='p_instance uuid';
  IF NOT FOUND THEN RAISE EXCEPTION '1: get_night_detail(uuid) does not exist'; END IF;

  -- 2. returns exactly one row for a visible (seeking/approved/future) instance
  select count(*) into n from get_night_detail(inst);
  IF n <> 1 THEN RAISE EXCEPTION '2: expected 1 row for visible instance, got %', n; END IF;

  -- 3. title surfaced
  select title into v_title from get_night_detail(inst);
  IF v_title <> 'late night downtown' THEN RAISE EXCEPTION '3: title wrong: %', v_title; END IF;

  -- 4. total cost surfaced
  select total_cost_pp into v_cost from get_night_detail(inst);
  IF v_cost <> 56 THEN RAISE EXCEPTION '4: total_cost_pp wrong: %', v_cost; END IF;

  -- 5. stops array surfaced (one stop)
  select jsonb_array_length(stops) into v_len from get_night_detail(inst);
  IF v_len <> 1 THEN RAISE EXCEPTION '5: expected 1 stop, got %', v_len; END IF;

  -- 6. venue name surfaced inside stops
  select stops->0->>'place_name' into v_name from get_night_detail(inst);
  IF v_name <> 'The Train Station Pub' THEN RAISE EXCEPTION '6: venue name wrong: %', v_name; END IF;

  -- 7. time is hour-truncated (no minute precision leaks)
  select date_part('minute', time_window_start)::int into v_minute from get_night_detail(inst);
  IF v_minute <> 0 THEN RAISE EXCEPTION '7: time not hour-truncated, minute=%', v_minute; END IF;

  -- 8. reservation_url is scrubbed from stops (possible identifying host link)
  select stops->0->>'reservation_url' into v_resv from get_night_detail(inst);
  IF v_resv IS NOT NULL THEN RAISE EXCEPTION '8: reservation_url not scrubbed: %', v_resv; END IF;

  -- 9. an unapproved instance returns zero rows (cannot detail-fetch by guessing the UUID).
  --    Mutate state as the table owner (RLS would silently no-op an authenticated UPDATE),
  --    then re-impersonate the viewer to read.
  reset role;
  update date_instances set moderation_status='pending' where id=inst;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);
  select count(*) into n from get_night_detail(inst);
  IF n <> 0 THEN RAISE EXCEPTION '9: unapproved instance returned % rows', n; END IF;
  reset role;
  update date_instances set moderation_status='approved' where id=inst;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);

  -- 10. the creator cannot detail-fetch their OWN instance (feed excludes self; detail mirrors it)
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);
  select count(*) into n from get_night_detail(inst);
  IF n <> 0 THEN RAISE EXCEPTION '10: creator saw own night, % rows', n; END IF;
  -- restore viewer impersonation
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);

  -- 11. the OUT signature exposes NO de-anonymization columns
  --     (itinerary_id / creator_id / venue_id must never appear as OUT params).
  reset role;
  select count(*) into v_outcols
    from information_schema.routines r
    join information_schema.parameters pm on pm.specific_name = r.specific_name
   where r.specific_schema='public' and r.routine_name='get_night_detail'
     and pm.parameter_mode='OUT'
     and pm.parameter_name in ('itinerary_id','creator_id','venue_id');
  IF v_outcols <> 0 THEN
    RAISE EXCEPTION '11: get_night_detail OUT signature exposes de-anon columns (count=%)', v_outcols;
  END IF;

  RAISE NOTICE 'm5_get_night_detail OK (11 assertions)';
  ROLLBACK;
END $$;
