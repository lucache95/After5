-- supabase/tests/s5_browse_feed_blind.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; usr uuid; itin uuid; inst uuid; kel uuid;
BEGIN
  select id into kel from cities where slug='kelowna';
  cre := mk_user('creator'); usr := mk_user('viewer');
  insert into profiles_private(user_id,birthdate) values (cre,(now()-interval '30 years')::date) on conflict(user_id) do update set birthdate=excluded.birthdate;
  insert into profiles_private(user_id,birthdate) values (usr,(now()-interval '30 years')::date) on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, verification='verified', dating_enabled=true where id=cre;
  update profiles set gender='woman', gender_preferences=array['man'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, verification='verified', dating_enabled=true where id=usr;
  itin := mk_itinerary(cre); inst := mk_instance(itin, cre, now()+interval '3 days');
  update date_instances set moderation_status='approved' where id=inst;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',usr,'role','authenticated')::text, true);
  CREATE TEMP TABLE _feed AS SELECT * FROM browse_feed_for_viewer(usr, null, null, null, 20);
  reset role;
  PERFORM 1 from information_schema.columns
    where table_name='_feed' and column_name in ('creator_id','creator','first_name','email','itinerary_id','venue_id');
  IF FOUND THEN RAISE EXCEPTION 'feed leaks creator identity column'; END IF;
  -- Verify content columns are present
  PERFORM 1 from information_schema.columns where table_name='_feed' and column_name='title';
  IF NOT FOUND THEN RAISE EXCEPTION 'feed missing title column'; END IF;
  PERFORM 1 from information_schema.columns where table_name='_feed' and column_name='why_note';
  IF NOT FOUND THEN RAISE EXCEPTION 'feed missing why_note column'; END IF;
  -- E10: the new fit column is present (computed boolean, carries no identity).
  PERFORM 1 from information_schema.columns where table_name='_feed' and column_name='fit';
  IF NOT FOUND THEN RAISE EXCEPTION 'feed missing fit column (E10 targeting signal)'; END IF;
  PERFORM 1 from _feed where date_instance_id=inst;
  IF NOT FOUND THEN RAISE EXCEPTION 'compatible night missing from feed'; END IF;
  DROP TABLE _feed;
  RAISE NOTICE 's5_browse_feed_blind OK';
  ROLLBACK;
END $$;
