-- supabase/tests/s5_post_night.sql
\i supabase/tests/_fixtures.sql
DO $do$
DECLARE cre uuid; other uuid; mine uuid; pub uuid; theirs uuid; inst uuid;
        live_venue uuid; auto_venue uuid; kel uuid;
BEGIN
  cre := mk_user('creator'); other := mk_user('other');
  insert into profiles_private (user_id, birthdate) values (cre, current_date - interval '25 years')
    on conflict (user_id) do update set birthdate = current_date - interval '25 years';
  update profiles set dating_enabled=true, verification='verified',
    primary_city_id=(select id from cities where slug='kelowna')
  where id=cre;
  mine := mk_itinerary(cre);
  theirs := mk_itinerary(other);                 -- not owned by creator, not public
  pub := mk_itinerary(other); update itineraries set is_public=true where id=pub;

  -- M1 venue fixtures: one curated 'live' place, one machine 'auto' place.
  kel := (select id from cities where slug='kelowna');
  insert into places (name, slug, type, price_tier, neighborhood, drive_cluster, is_active, approval_status, city_id, source)
    values ('Live Test Venue', 'live-test-venue-m1', 'restaurant', '$$', 'downtown', 'downtown', true, 'live', kel, 'curated')
    returning id into live_venue;
  insert into places (name, slug, type, price_tier, neighborhood, drive_cluster, is_active, approval_status, city_id, source)
    values ('Auto Test Venue', 'auto-test-venue-m1', 'cafe', '$$', 'downtown', 'downtown', true, 'auto', kel, 'discovered')
    returning id into auto_venue;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);

  inst := post_night(mine, now()+interval '5 days', null, 150);
  PERFORM 1 from date_instances where id=inst and creator_id=cre and status='seeking';
  IF NOT FOUND THEN RAISE EXCEPTION 'post_night did not create a seeking instance for the creator'; END IF;

  -- M1: a curated 'live' venue is accepted.
  inst := post_night(mine, now()+interval '6 days', live_venue, 150);
  PERFORM 1 from date_instances where id=inst and venue_id=live_venue;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_night should accept a live venue'; END IF;

  -- M1: an 'auto'/discovered venue is rejected.
  BEGIN PERFORM post_night(mine, now()+interval '7 days', auto_venue, 150);
    RAISE EXCEPTION 'auto venue should have been rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL; END;

  PERFORM post_night(pub, now()+interval '5 days', null, 150);   -- public itinerary allowed

  BEGIN PERFORM post_night(mine, now()-interval '1 day', null, 150);
    RAISE EXCEPTION 'past starts_at should have been rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL; END;

  BEGIN PERFORM post_night(theirs, now()+interval '5 days', null, 150);
    RAISE EXCEPTION 'foreign private itinerary should have been rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL; END;

  reset role;
  update profiles set verification='unverified' where id=cre;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);
  BEGIN PERFORM post_night(mine, now()+interval '5 days', null, 150);
    RAISE EXCEPTION 'unverified creator should have been rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN NULL; END;
  reset role;

  RAISE NOTICE 's5_post_night OK';
  ROLLBACK;
END $do$;
