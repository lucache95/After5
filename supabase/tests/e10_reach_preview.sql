-- supabase/tests/e10_reach_preview.sql
-- E10 (REQ-E10): reach_preview(p_target_genders text[], p_target_age_range int4range,
--   p_city uuid, p_radius_km numeric) returns integer -- a lean DEFINER count of the
--   profiles a prospective night's targeting would reach.
--   (a) counts matching verified + dating_enabled profiles, excluding auth.uid();
--   (b) {everyone} and {} both count everyone (>= a specific-gender count);
--   (c) age + radius narrowing reduces the count monotonically;
--   (d) anon EXECUTE revoked, authenticated granted.
--
-- Harness mirrors e11_targeting.sql (jwt-claims, positional RPC, ROLLBACK).
-- RED until 20260605120600_e10_reach_preview.sql lands.
\i supabase/tests/_fixtures.sql

-- Seed a small, controlled population of verified dating profiles in kelowna so the
-- counts are deterministic relative to each other (we assert relative monotonicity,
-- not absolute counts, to stay robust against any pre-existing seed data).
DO $do$
DECLARE caller uuid; kel uuid; far uuid;
        w1 uuid; w2 uuid; m1 uuid;
        cnt_open int; cnt_everyone int; cnt_women int; cnt_women_young int; cnt_women_near int;
BEGIN
  select id into kel from cities where slug='kelowna';
  select id into far from cities where slug <> 'kelowna' and centroid is not null
    order by st_distance(centroid, (select centroid from cities where id=kel)) desc limit 1;

  caller := mk_user('e10_rp_caller');
  -- two women (one young in kelowna, one older in the far city) + one man in kelowna
  w1 := mk_user('e10_rp_w1');   -- woman, 27, kelowna
  w2 := mk_user('e10_rp_w2');   -- woman, 45, far city
  m1 := mk_user('e10_rp_m1');   -- man,   30, kelowna

  insert into profiles_private(user_id,birthdate) values
    (w1,(now()-interval '27 years')::date),
    (w2,(now()-interval '45 years')::date),
    (m1,(now()-interval '30 years')::date)
  on conflict(user_id) do update set birthdate=excluded.birthdate;

  update profiles set gender='woman', age=27, verification='verified', dating_enabled=true,
    primary_city_id=kel where id=w1;
  update profiles set gender='woman', age=45, verification='verified', dating_enabled=true,
    primary_city_id=coalesce(far,kel) where id=w2;
  update profiles set gender='man', age=30, verification='verified', dating_enabled=true,
    primary_city_id=kel where id=m1;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',caller,'role','authenticated')::text, true);

  -- (a)+(b): open ({}) and {everyone} count the SAME set, and both >= a specific gender count
  cnt_open     := reach_preview('{}'::text[], null, null, null);
  cnt_everyone := reach_preview(array['everyone']::text[], null, null, null);
  cnt_women    := reach_preview(array['woman']::text[], null, null, null);

  IF cnt_open <> cnt_everyone THEN
    RAISE EXCEPTION 'E10.RP.b: {} and {everyone} must count the same set (open=% everyone=%)', cnt_open, cnt_everyone;
  END IF;
  IF cnt_open < cnt_women THEN
    RAISE EXCEPTION 'E10.RP.b: open count must be >= a specific-gender count (open=% women=%)', cnt_open, cnt_women;
  END IF;
  -- our seed adds 2 women + 1 man, none is the caller, so women>=2 and open>=women+1
  IF cnt_women < 2 THEN
    RAISE EXCEPTION 'E10.RP.a: expected at least the 2 seeded women in the women count (got %)', cnt_women;
  END IF;
  IF cnt_open < cnt_women + 1 THEN
    RAISE EXCEPTION 'E10.RP.a: open count must also include the seeded man (open=% women=%)', cnt_open, cnt_women;
  END IF;

  -- (c): age narrowing reduces count -- restrict to 25..35 drops the 45yo woman
  cnt_women_young := reach_preview(array['woman']::text[], int4range(25,35), null, null);
  IF cnt_women_young >= cnt_women THEN
    RAISE EXCEPTION 'E10.RP.c: age narrowing must reduce the count (all=% young=%)', cnt_women, cnt_women_young;
  END IF;

  -- (c): radius narrowing reduces count -- 10km around kelowna drops the far-city woman.
  -- only assert when a genuine far city exists, otherwise the radius can not separate them.
  IF far IS NOT NULL THEN
    cnt_women_near := reach_preview(array['woman']::text[], null, kel, 10::numeric);
    IF cnt_women_near >= cnt_women THEN
      RAISE EXCEPTION 'E10.RP.c: radius narrowing must reduce the count (all=% near=%)', cnt_women, cnt_women_near;
    END IF;
  END IF;

  reset role;
  RAISE NOTICE 'E10.RP.a/b/c: reach_preview counts + everyone-norm + narrowing OK';
  ROLLBACK;
END $do$;

-- (d) anon EXECUTE revoked; authenticated granted
DO $do$
BEGIN
  IF has_function_privilege('anon',
       'reach_preview(text[], int4range, uuid, numeric)','execute') THEN
    RAISE EXCEPTION 'E10.RP.d: anon should NOT execute reach_preview';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'reach_preview(text[], int4range, uuid, numeric)','execute') THEN
    RAISE EXCEPTION 'E10.RP.d: authenticated SHOULD execute reach_preview';
  END IF;
  RAISE NOTICE 'E10.RP.d: anon revoked / authenticated granted OK';
END $do$;
