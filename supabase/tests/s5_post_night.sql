-- supabase/tests/s5_post_night.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; other uuid; mine uuid; pub uuid; theirs uuid; inst uuid;
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

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',cre,'role','authenticated')::text, true);

  inst := post_night(mine, now()+interval '5 days', null, 150);
  PERFORM 1 from date_instances where id=inst and creator_id=cre and status='seeking';
  IF NOT FOUND THEN RAISE EXCEPTION 'post_night did not create a seeking instance for the creator'; END IF;

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
END $$;
