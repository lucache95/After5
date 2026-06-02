-- supabase/tests/m3_post_night_fork.sql
-- M3: post_night forks the itinerary so the posted night owns a private copy.
\i supabase/tests/_fixtures.sql
insert into feature_config(key,value) values ('match_v2_enabled','true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;
DO $$
DECLARE host uuid; canon uuid; cid uuid; inst uuid; forked uuid; canon_title text;
BEGIN
  host := mk_user('m3_host');
  insert into profiles_private(user_id, birthdate) values (host,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true, verification='verified',
    primary_city_id=(select id from cities where slug='kelowna') where id=host;
  canon := mk_itinerary(host);
  update itineraries set title='canonical night',
    stops='[{"place_id":"p1","place_name":"a","start_time":"18:00","duration_min":60,"estimated_cost_pp":20}]'::jsonb,
    is_public=true where id=canon;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', host::text, 'role','authenticated')::text, true);
  inst := post_night(canon, now() + interval '2 days', null, 150, null);

  SELECT itinerary_id INTO forked FROM date_instances WHERE id=inst;
  IF forked = canon THEN RAISE EXCEPTION 'M3.2a: post_night did NOT fork (instance points at canonical)'; END IF;
  RAISE NOTICE 'M3.2a: posted night points at a forked itinerary OK';

  -- the fork is a faithful copy owned by the host
  PERFORM 1 FROM itineraries WHERE id=forked AND user_id=host AND title='canonical night'
    AND jsonb_array_length(stops)=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'M3.2b: fork is not a faithful host-owned copy'; END IF;
  RAISE NOTICE 'M3.2b: fork is a faithful host-owned copy OK';

  -- editing the fork does NOT change the canonical
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', host::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_itinerary_stops(forked,
    '[{"place_id":"p1","place_name":"edited","start_time":"19:00","duration_min":90,"estimated_cost_pp":40}]'::jsonb,
    'edited night', null, null);
  RESET ROLE;
  SELECT title INTO canon_title FROM itineraries WHERE id=canon;
  IF canon_title <> 'canonical night' THEN RAISE EXCEPTION 'M3.2c: editing the fork bled into the canonical (%)', canon_title; END IF;
  RAISE NOTICE 'M3.2c: editing the fork leaves canonical untouched OK';

  RAISE NOTICE 'M3.2: post_night fork-on-post OK';
  ROLLBACK;
END $$;
