-- supabase/tests/s5_browse_feed_compat.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE kel uuid; cre uuid; viewer uuid; bad uuid; itin uuid; itin2 uuid; inst uuid; inst_bad uuid; past uuid; n int;
BEGIN
  select id into kel from cities where slug='kelowna';
  cre := mk_user('cre'); viewer := mk_user('viewer'); bad := mk_user('incompat');
  insert into profiles_private(user_id,birthdate) values (cre,(now()-interval '30 years')::date) on conflict(user_id) do update set birthdate=excluded.birthdate;
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date) on conflict(user_id) do update set birthdate=excluded.birthdate;
  insert into profiles_private(user_id,birthdate) values (bad,(now()-interval '30 years')::date) on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, verification='verified', dating_enabled=true where id=cre;
  update profiles set gender='woman', gender_preferences=array['man'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, verification='verified', dating_enabled=true where id=viewer;
  update profiles set gender='woman', gender_preferences=array['woman'], age=30, age_pref=int4range(25,40),
    distance_pref_km=50, primary_city_id=kel, verification='verified', dating_enabled=true where id=bad;

  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now()+interval '3 days');
  past := mk_instance(itin, cre, now()-interval '1 day');
  itin2 := mk_itinerary(bad);
  inst_bad := mk_instance(itin2, bad, now()+interval '3 days');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);

  select count(*) into n from browse_feed_for_viewer(viewer, null, null, null, 50) where date_instance_id=inst;
  IF n<>1 THEN RAISE EXCEPTION 'compatible future night should appear exactly once (got %)', n; END IF;
  select count(*) into n from browse_feed_for_viewer(viewer, null, null, null, 50) where date_instance_id in (past, inst_bad);
  IF n<>0 THEN RAISE EXCEPTION 'past or incompatible nights leaked into feed (got %)', n; END IF;

  perform record_swipe(inst, 'left');
  select count(*) into n from browse_feed_for_viewer(viewer, null, null, null, 50) where date_instance_id=inst;
  IF n<>0 THEN RAISE EXCEPTION 'already-swiped night still in feed'; END IF;
  reset role;
  RAISE NOTICE 's5_browse_feed_compat OK';
  ROLLBACK;
END $$;
