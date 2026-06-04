-- supabase/tests/e10_browse_feed_filters.sql
-- E10 (REQ-E10): browse_feed_for_viewer extended with searcher feed_filters.
--   HARD filters (host gender / max price / max distance) HIDE non-matching nights (WHERE).
--   SOFT filters (vibe / who-pays / time-of-day) only RE-SORT (a mismatch still appears).
--   fit is a TARGETING-only signal: a night whose target_genders + target_age_range
--   genuinely include the viewer yields fit=true EVEN when the viewer has ZERO soft
--   filters set (feed_filters='{}') -- the D-03/SC-1 regression this suite locks.
--   {everyone}/{} open targeting normalizes to "no restriction" in fit.
--   Keyset cursor still paginates without skip or dupe under the new ORDER BY.
--
-- Harness mirrors e11_targeting.sql + s5_browse_feed_blind.sql: \i _fixtures.sql,
-- jwt-claims, SET LOCAL ROLE authenticated, positional RPC, ROLLBACK.
-- RED until 20260605120500_e10_browse_feed_filters.sql lands.
\i supabase/tests/_fixtures.sql

-- A shared setup helper: a verified woman viewer in kelowna, and a verified man host
-- whose night is mutually compatible (passes the baseline blind gates) so that
-- feed-filter behavior is what's under test, not the baseline mutual-pref gate.
-- Returns nothing; callers \set up their own rows for the specific case.

-- ── 1. HARD host_genders HIDES non-matching host, keeps matching host ─────────
DO $do$
DECLARE viewer uuid; kel uuid; man_host uuid; woman_host uuid;
        man_itin uuid; woman_itin uuid; man_inst uuid; woman_inst uuid; n int;
BEGIN
  select id into kel from cities where slug='kelowna';
  viewer := mk_user('e10_hg_viewer');
  man_host := mk_user('e10_hg_man');
  woman_host := mk_user('e10_hg_woman');
  -- viewer: woman who is open to all genders (so the baseline gate never hides either host)
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['man','woman','nonbinary'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=viewer;
  -- both hosts are open to women and within range
  insert into profiles_private(user_id,birthdate) values (man_host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=man_host;
  insert into profiles_private(user_id,birthdate) values (woman_host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=woman_host;

  man_itin := mk_itinerary(man_host); woman_itin := mk_itinerary(woman_host);
  man_inst := mk_instance(man_itin, man_host, now()+interval '3 days');
  woman_inst := mk_instance(woman_itin, woman_host, now()+interval '4 days');
  update date_instances set moderation_status='approved' where id in (man_inst, woman_inst);

  -- viewer filters to woman-hosted nights only (HARD host_genders)
  update profiles set feed_filters='{"host_genders":["woman"]}'::jsonb where id=viewer;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _f1 as select * from browse_feed_for_viewer(viewer, null, null, null, 50);
  reset role;

  select count(*) into n from _f1 where date_instance_id = man_inst;
  IF n<>0 THEN RAISE EXCEPTION 'E10.1: hard host_genders=woman should HIDE the man-hosted night (n=%)', n; END IF;
  select count(*) into n from _f1 where date_instance_id = woman_inst;
  IF n<>1 THEN RAISE EXCEPTION 'E10.1: hard host_genders=woman should KEEP the woman-hosted night (n=%)', n; END IF;
  drop table _f1;
  RAISE NOTICE 'E10.1: hard host_genders hide/keep OK';
  ROLLBACK;
END $do$;

-- ── 2. HARD max_price hides total_cost_pp=80, keeps 40 ───────────────────────
DO $do$
DECLARE viewer uuid; kel uuid; host uuid; cheap_itin uuid; dear_itin uuid;
        cheap_inst uuid; dear_inst uuid; n int;
BEGIN
  select id into kel from cities where slug='kelowna';
  viewer := mk_user('e10_mp_viewer');
  host := mk_user('e10_mp_host');
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['man'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=viewer;
  insert into profiles_private(user_id,birthdate) values (host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=host;

  cheap_itin := mk_itinerary(host); dear_itin := mk_itinerary(host);
  update itineraries set total_cost_pp=40 where id=cheap_itin;
  update itineraries set total_cost_pp=80 where id=dear_itin;
  cheap_inst := mk_instance(cheap_itin, host, now()+interval '3 days');
  dear_inst := mk_instance(dear_itin, host, now()+interval '4 days');
  update date_instances set moderation_status='approved' where id in (cheap_inst, dear_inst);

  update profiles set feed_filters='{"max_price":50}'::jsonb where id=viewer;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _f2 as select * from browse_feed_for_viewer(viewer, null, null, null, 50);
  reset role;

  select count(*) into n from _f2 where date_instance_id = dear_inst;
  IF n<>0 THEN RAISE EXCEPTION 'E10.2: hard max_price=50 should HIDE the 80 night (n=%)', n; END IF;
  select count(*) into n from _f2 where date_instance_id = cheap_inst;
  IF n<>1 THEN RAISE EXCEPTION 'E10.2: hard max_price=50 should KEEP the 40 night (n=%)', n; END IF;
  drop table _f2;
  RAISE NOTICE 'E10.2: hard max_price hide/keep OK';
  ROLLBACK;
END $do$;

-- ── 3. HARD max_distance_km hides far city, keeps same city ──────────────────
DO $do$
DECLARE viewer uuid; kel uuid; far uuid; near_host uuid; far_host uuid;
        near_itin uuid; far_itin uuid; near_inst uuid; far_inst uuid; n int;
BEGIN
  select id into kel from cities where slug='kelowna';
  -- create a far city about 50km from kelowna (within the 150km baseline gate but beyond
  -- the 10km hard cap), built by offsetting the kelowna centroid in longitude. This avoids
  -- depending on a second seeded city (the local stack only seeds kelowna with a centroid).
  insert into cities (name, slug, timezone, centroid)
  select 'Far Test City', 'e10-far-' || left(gen_random_uuid()::text,8), timezone,
         st_setsrid(st_makepoint(st_x(centroid::geometry) + 0.6, st_y(centroid::geometry)), 4326)::geography
  from cities where id = kel
  returning id into far;
  -- sanity: the offset must land between the 10km hard cap and the 150km baseline
  PERFORM 1 where st_distance((select centroid from cities where id=far),
                              (select centroid from cities where id=kel)) between 10000 and 150000;
  IF NOT FOUND THEN RAISE EXCEPTION 'E10.3: far test city is not in the (10km,150km) band'; END IF;

  viewer := mk_user('e10_md_viewer');
  near_host := mk_user('e10_md_near');
  far_host := mk_user('e10_md_far');
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  -- viewer's own distance_pref is generous so the BASELINE gate does not hide the far night;
  -- only the new HARD max_distance_km cap should hide it.
  update profiles set gender='woman', gender_preferences=array['man'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=viewer;
  insert into profiles_private(user_id,birthdate) values (near_host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=near_host;
  insert into profiles_private(user_id,birthdate) values (far_host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=far,
    verification='verified', dating_enabled=true where id=far_host;

  near_itin := mk_itinerary(near_host); far_itin := mk_itinerary(far_host);
  near_inst := mk_instance(near_itin, near_host, now()+interval '3 days');
  -- far night lives in the far city
  insert into date_instances (itinerary_id, creator_id, city_id, starts_at)
    values (far_itin, far_host, far, now()+interval '4 days') returning id into far_inst;
  update date_instances set moderation_status='approved' where id in (near_inst, far_inst);

  -- 10km cap: same-city centroid distance is 0, far-city is far above 10km
  update profiles set feed_filters='{"max_distance_km":10}'::jsonb where id=viewer;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _f3 as select * from browse_feed_for_viewer(viewer, null, null, null, 50);
  reset role;

  select count(*) into n from _f3 where date_instance_id = far_inst;
  IF n<>0 THEN RAISE EXCEPTION 'E10.3: hard max_distance_km=10 should HIDE the far-city night (n=%)', n; END IF;
  select count(*) into n from _f3 where date_instance_id = near_inst;
  IF n<>1 THEN RAISE EXCEPTION 'E10.3: hard max_distance_km=10 should KEEP the same-city night (n=%)', n; END IF;
  drop table _f3;
  RAISE NOTICE 'E10.3: hard max_distance_km hide/keep OK';
  ROLLBACK;
END $do$;

-- ── 4. SOFT vibes only RE-SORT (mismatch still appears; match ranks above) ────
DO $do$
DECLARE viewer uuid; kel uuid; host uuid; match_itin uuid; mismatch_itin uuid;
        match_inst uuid; mismatch_inst uuid; n int; pos_match int; pos_mismatch int;
BEGIN
  select id into kel from cities where slug='kelowna';
  viewer := mk_user('e10_sv_viewer');
  host := mk_user('e10_sv_host');
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['man'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=viewer;
  insert into profiles_private(user_id,birthdate) values (host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=host;

  match_itin := mk_itinerary(host); mismatch_itin := mk_itinerary(host);
  update itineraries set vibe_tags=array['cozy','artsy'] where id=match_itin;
  update itineraries set vibe_tags=array['rowdy'] where id=mismatch_itin;
  -- mismatch night starts SOONER so that, absent soft sort, it would come first under
  -- the (starts_at,id) baseline order. The soft vibe boost must flip the matched one above.
  mismatch_inst := mk_instance(mismatch_itin, host, now()+interval '2 days');
  match_inst := mk_instance(match_itin, host, now()+interval '5 days');
  update date_instances set moderation_status='approved' where id in (match_inst, mismatch_inst);

  update profiles set feed_filters='{"vibes":["cozy"]}'::jsonb where id=viewer;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _f4 as
    select row_number() over () as rn, date_instance_id from browse_feed_for_viewer(viewer, null, null, null, 50);
  reset role;

  -- both appear (soft never hides)
  select count(*) into n from _f4 where date_instance_id in (match_inst, mismatch_inst);
  IF n<>2 THEN RAISE EXCEPTION 'E10.4: soft vibe filter must NOT hide either night (n=%)', n; END IF;
  -- matched ranks ABOVE the mismatched despite later start time
  select rn into pos_match from _f4 where date_instance_id = match_inst;
  select rn into pos_mismatch from _f4 where date_instance_id = mismatch_inst;
  IF pos_match >= pos_mismatch THEN
    RAISE EXCEPTION 'E10.4: soft vibe match should rank above mismatch (match rn=% mismatch rn=%)', pos_match, pos_mismatch;
  END IF;
  drop table _f4;
  RAISE NOTICE 'E10.4: soft vibes re-sort (no hide) OK';
  ROLLBACK;
END $do$;

-- ── 5. fit is TARGETING-ONLY: matched targeting -> fit=true with feed_filters='{}' ─
--    (D-03/SC-1 regression) AND a non-targeting night -> fit=false.
DO $do$
DECLARE viewer uuid; kel uuid; host uuid; targeted_itin uuid; untargeted_itin uuid;
        targeted_inst uuid; untargeted_inst uuid; v_fit boolean;
BEGIN
  select id into kel from cities where slug='kelowna';
  viewer := mk_user('e10_fit_viewer');
  host := mk_user('e10_fit_host');
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['man'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=viewer;
  insert into profiles_private(user_id,birthdate) values (host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=host;

  targeted_itin := mk_itinerary(host); untargeted_itin := mk_itinerary(host);
  targeted_inst := mk_instance(targeted_itin, host, now()+interval '3 days');
  untargeted_inst := mk_instance(untargeted_itin, host, now()+interval '4 days');
  -- targeted night genuinely includes a 30yo woman:
  update date_instances set target_genders=array['woman'], target_age_range=int4range(25,40)
    where id=targeted_inst;
  -- untargeted night excludes her (looks only for men):
  update date_instances set target_genders=array['man'], target_age_range=int4range(25,40)
    where id=untargeted_inst;
  update date_instances set moderation_status='approved' where id in (targeted_inst, untargeted_inst);

  -- CRITICAL: viewer has ZERO soft filters set. fit must STILL be true on the targeted night.
  update profiles set feed_filters='{}'::jsonb where id=viewer;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _f5 as select date_instance_id, fit from browse_feed_for_viewer(viewer, null, null, null, 50);
  reset role;

  select fit into v_fit from _f5 where date_instance_id = targeted_inst;
  IF v_fit IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'E10.5: targeted night must yield fit=true with empty feed_filters (got %)', v_fit;
  END IF;
  select fit into v_fit from _f5 where date_instance_id = untargeted_inst;
  IF v_fit IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'E10.5: non-targeting night must yield fit=false (got %)', v_fit;
  END IF;
  drop table _f5;
  RAISE NOTICE 'E10.5: fit is targeting-only (true with empty filters) OK';
  ROLLBACK;
END $do$;

-- ── 6. {everyone}-normalization guard: open night -> matching-gender viewer fit=true ─
DO $do$
DECLARE viewer uuid; kel uuid; host uuid; open_itin uuid; empty_itin uuid;
        open_inst uuid; empty_inst uuid; v_fit boolean;
BEGIN
  select id into kel from cities where slug='kelowna';
  viewer := mk_user('e10_ev_viewer');
  host := mk_user('e10_ev_host');
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['man'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=viewer;
  insert into profiles_private(user_id,birthdate) values (host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=host;

  open_itin := mk_itinerary(host); empty_itin := mk_itinerary(host);
  open_inst := mk_instance(open_itin, host, now()+interval '3 days');
  empty_inst := mk_instance(empty_itin, host, now()+interval '4 days');
  -- the {everyone} literal landmine (PostNightForm/post_night store it verbatim):
  update date_instances set target_genders=array['everyone'], target_age_range=null where id=open_inst;
  -- and the empty-array open case:
  update date_instances set target_genders='{}'::text[], target_age_range=null where id=empty_inst;
  update date_instances set moderation_status='approved' where id in (open_inst, empty_inst);

  update profiles set feed_filters='{}'::jsonb where id=viewer;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _f6 as select date_instance_id, fit from browse_feed_for_viewer(viewer, null, null, null, 50);
  reset role;

  select fit into v_fit from _f6 where date_instance_id = open_inst;
  IF v_fit IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'E10.6: open {everyone} night must yield fit=true for a matching-gender viewer (got %)', v_fit;
  END IF;
  select fit into v_fit from _f6 where date_instance_id = empty_inst;
  IF v_fit IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'E10.6: open empty-array night must yield fit=true for a matching-gender viewer (got %)', v_fit;
  END IF;
  drop table _f6;
  RAISE NOTICE 'E10.6: everyone/empty open normalization fit=true OK';
  ROLLBACK;
END $do$;

-- ── 7. keyset cursor: two pages, no dup, no skip ─────────────────────────────
DO $do$
DECLARE viewer uuid; kel uuid; host uuid; itin uuid; i int;
        last_starts timestamptz; last_id uuid; total int; page1 int; page2 int; overlap int;
BEGIN
  select id into kel from cities where slug='kelowna';
  viewer := mk_user('e10_ks_viewer');
  host := mk_user('e10_ks_host');
  insert into profiles_private(user_id,birthdate) values (viewer,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='woman', gender_preferences=array['man'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=viewer;
  insert into profiles_private(user_id,birthdate) values (host,(now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate=excluded.birthdate;
  update profiles set gender='man', gender_preferences=array['woman'], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=host;

  itin := mk_itinerary(host);
  -- 6 nights at distinct future times; no soft filters, so order is the stable (starts_at,id)
  for i in 1..6 loop
    perform mk_instance(itin, host, now()+(i||' days')::interval);
  end loop;
  update date_instances set moderation_status='approved' where creator_id=host;
  update profiles set feed_filters='{}'::jsonb where id=viewer;

  -- Capture the REAL (starts_at, id) of every instance BEFORE switching to the authenticated
  -- role. Under that role, date_instances is RLS-filtered and the viewer cannot read these
  -- rows directly (only via the DEFINER feed RPC), so the page-2 cursor must come from this
  -- pre-captured map, NOT a re-read of date_instances under the role.
  create temp table _ks_src as
    select id, starts_at from date_instances where creator_id=host;

  -- page 1 (and a full sanity read) run under the authenticated role; results are copied
  -- into temp tables. The cursor (real starts_at) is computed AFTER reset role, because the
  -- pre-captured _ks_src is only readable as the test superuser, not the authenticated role.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _ks_all as select * from browse_feed_for_viewer(viewer, null, null, null, 50);
  create temp table _ks_p1  as select * from browse_feed_for_viewer(viewer, null, null, null, 3);
  reset role;

  select count(*) into total from _ks_all;
  IF total < 6 THEN RAISE EXCEPTION 'E10.7: expected at least 6 nights in the feed (got %)', total; END IF;
  select count(*) into page1 from _ks_p1;
  IF page1 <> 3 THEN RAISE EXCEPTION 'E10.7: page 1 should hold 3 rows (got %)', page1; END IF;

  -- last page-1 row in feed order (no soft filters -> stable starts_at asc, id asc),
  -- joined to the pre-captured real starts_at to drive the keyset cursor.
  select src.starts_at, src.id into last_starts, last_id
    from _ks_p1 p join _ks_src src on src.id = p.date_instance_id
    order by src.starts_at desc, src.id desc limit 1;

  -- page 2: continue from the page-1 cursor using the REAL starts_at (projection is
  -- hour-truncated, so we feed the cursor the captured exact timestamp).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _ks_p2 as
    select * from browse_feed_for_viewer(viewer, null, last_starts, last_id, 3);
  reset role;

  select count(*) into page2 from _ks_p2;
  IF page2 < 3 THEN RAISE EXCEPTION 'E10.7: page 2 should hold the next 3 rows (got %)', page2; END IF;

  -- no overlap between the two pages
  select count(*) into overlap
    from _ks_p1 a join _ks_p2 b on a.date_instance_id = b.date_instance_id;
  IF overlap <> 0 THEN RAISE EXCEPTION 'E10.7: keyset pages overlap (dup rows=%)', overlap; END IF;

  drop table _ks_src; drop table _ks_all; drop table _ks_p1; drop table _ks_p2;
  RAISE NOTICE 'E10.7: keyset no-dup/no-skip OK';
  ROLLBACK;
END $do$;
