-- supabase/tests/p1_preferences.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; bad boolean := false;
BEGIN
  u := mk_user('p');
  BEGIN
    update profiles set age_pref = int4range(17, 30) where id = u;
  EXCEPTION WHEN check_violation THEN bad := true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'PREF CHECK FAILED: age_pref accepted lower bound 17'; END IF;
  bad := false;
  BEGIN
    update profiles set distance_pref_km = 0 where id = u;
  EXCEPTION WHEN check_violation THEN bad := true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'PREF CHECK FAILED: distance 0 accepted'; END IF;
  update profiles set gender='woman', gender_preferences='{man,nonbinary}',
                      age_pref=int4range(25,40), distance_pref_km=35, dealbreakers='{smoking}'
   where id = u;
  PERFORM 1 FROM profiles WHERE id=u AND lower(age_pref)=25;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREF CHECK FAILED: valid prefs rejected'; END IF;
  RAISE NOTICE 'preferences OK';
  ROLLBACK;
END $$;
