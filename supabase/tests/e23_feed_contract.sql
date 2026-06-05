-- supabase/tests/e23_feed_contract.sql
-- E23/E22 (REQ-E23 / REQ-E22 / D-03): the feed-RPC re-CREATE REGRESSION lock.
--
-- This is the single most important new test in the phase. It locks the
-- privacy/host-hint/keyset CONTRACT so the E22/E23 DROP+CREATE of
-- browse_feed_for_viewer (20260606140100_e23_browse_feed_city_and_tune.sql) can
-- never silently:
--   * drop a host-hint column or re-expose more than the 3 allowed hints,
--   * re-grant anon EXECUTE on the DEFINER feed read,
--   * destabilize the (starts_at,id) keyset cursor from the soft-score tune,
--   * or return a wrong/absent city_name label.
--
-- Asserts (the <action> block of Task 2):
--   1. The function's OUT column set is EXACTLY the 14 e10 cols + the 3 e15
--      host-hint cols + city_name (18 total), with city_name present and no
--      forbidden creator leak (id/email/clear_photo_url/instagram) in the shape.
--   2. anon has NO EXECUTE; authenticated DOES (has_function_privilege).
--   3. Keyset stability — page 2 from page-1's last (starts_at,id) cursor yields
--      no duplicate and no skipped date_instance_id across the boundary.
--   4. city_name equals cities.name for a known seed night (kelowna).
--
-- Harness mirrors e10_browse_feed_filters.sql: \i _fixtures.sql, jwt-claims,
-- SET LOCAL ROLE authenticated, positional RPC, temp tables, ROLLBACK.
-- RED until 20260606140100_e23_browse_feed_city_and_tune.sql lands.
\i supabase/tests/_fixtures.sql

-- ── 1. exact OUT column set: 14 e10 + 3 host-hint + city_name (18), in order ──
DO $do$
DECLARE
  got text[];
  want text[] := array[
    'date_instance_id','city_id','time_window_start','pay_setting','vibe_tags',
    'why_note','cover_image_url','title','venue_neighborhood','is_seed','distance_m',
    'ambient_sound_path','ambient_sound_name','fit',
    'host_blurred_photo_url','host_first_name','host_age',
    'city_name'
  ];
  forbidden text[] := array['id','email','clear_photo_url','instagram','dob','birthdate'];
  bad text;
BEGIN
  select array_agg(p.parameter_name order by p.ordinal_position)
    into got
  from information_schema.parameters p
  join information_schema.routines r on r.specific_name = p.specific_name
  where r.routine_name = 'browse_feed_for_viewer'
    and r.routine_schema = 'public'
    and p.parameter_mode = 'OUT';

  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'E23.1: OUT column set/order mismatch.%  got=%  want=%',
      chr(10), got, want;
  END IF;

  -- belt-and-braces: none of the forbidden creator fields leak into the shape.
  FOREACH bad IN ARRAY forbidden LOOP
    IF bad = ANY(got) THEN
      RAISE EXCEPTION 'E23.1: forbidden creator field % must NOT be a return column', bad;
    END IF;
  END LOOP;

  RAISE NOTICE 'E23.1: exact 18-col contract (14 e10 + 3 host-hint + city_name), no leak OK';
END $do$;

-- ── 2. privilege boundary: anon revoked, authenticated granted ───────────────
DO $do$
DECLARE anon_ok boolean; auth_ok boolean; pub_ok boolean;
BEGIN
  SELECT has_function_privilege('anon',
    'browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int)', 'EXECUTE') INTO anon_ok;
  SELECT has_function_privilege('authenticated',
    'browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int)', 'EXECUTE') INTO auth_ok;
  SELECT has_function_privilege('public',
    'browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int)', 'EXECUTE') INTO pub_ok;
  IF anon_ok THEN
    RAISE EXCEPTION 'E23.2: anon must NOT have EXECUTE on browse_feed_for_viewer';
  END IF;
  IF pub_ok THEN
    RAISE EXCEPTION 'E23.2: PUBLIC must NOT have EXECUTE on browse_feed_for_viewer';
  END IF;
  IF NOT auth_ok THEN
    RAISE EXCEPTION 'E23.2: authenticated MUST have EXECUTE on browse_feed_for_viewer';
  END IF;
  RAISE NOTICE 'E23.2: anon+public denied, authenticated granted OK';
END $do$;

-- ── 3. city_name = cities.name for a known seed night (kelowna) ──────────────
DO $do$
DECLARE viewer uuid; kel uuid; kel_name text; host uuid; itin uuid; inst uuid; got text;
BEGIN
  select id, name into kel, kel_name from cities where slug='kelowna';
  viewer := mk_user('e23_cn_viewer');
  host   := mk_user('e23_cn_host');
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
  inst := mk_instance(itin, host, now()+interval '3 days');
  update date_instances set moderation_status='approved' where id=inst;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  select city_name into got from browse_feed_for_viewer(viewer, null, null, null, 50)
    where date_instance_id = inst;
  reset role;

  IF got IS DISTINCT FROM kel_name THEN
    RAISE EXCEPTION 'E23.3: city_name must equal cities.name (got %, want %)', got, kel_name;
  END IF;
  RAISE NOTICE 'E23.3: city_name = cities.name (%) OK', kel_name;
  ROLLBACK;
END $do$;

-- ── 4. keyset cursor stays stable under the tuned soft-score: no dup, no skip ─
--    Mirrors e10_browse_feed_filters.sql §7. The E22 tune changes the score
--    expression only; the (starts_at,id) keyset tail must remain byte-identical,
--    so paginating from page-1's last cursor must not dupe or skip.
DO $do$
DECLARE viewer uuid; kel uuid; host uuid; itin uuid; i int;
        last_starts timestamptz; last_id uuid; total int; page1 int; page2 int; overlap int;
BEGIN
  select id into kel from cities where slug='kelowna';
  viewer := mk_user('e23_ks_viewer');
  host   := mk_user('e23_ks_host');
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
  -- 6 nights at distinct future times; no soft filters set, so the score term is
  -- constant across rows and order is the stable (starts_at,id) keyset.
  for i in 1..6 loop
    perform mk_instance(itin, host, now()+(i||' days')::interval);
  end loop;
  update date_instances set moderation_status='approved' where creator_id=host;
  update profiles set feed_filters='{}'::jsonb where id=viewer;

  -- Capture the REAL (starts_at,id) of every instance as superuser BEFORE switching
  -- roles (under the authenticated role date_instances is RLS-filtered; the cursor
  -- must come from this pre-captured map, not a re-read).
  create temp table _ks_src as
    select id, starts_at from date_instances where creator_id=host;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _ks_all as select * from browse_feed_for_viewer(viewer, null, null, null, 50);
  create temp table _ks_p1  as select * from browse_feed_for_viewer(viewer, null, null, null, 3);
  reset role;

  select count(*) into total from _ks_all;
  IF total < 6 THEN RAISE EXCEPTION 'E23.4: expected at least 6 nights in the feed (got %)', total; END IF;
  select count(*) into page1 from _ks_p1;
  IF page1 <> 3 THEN RAISE EXCEPTION 'E23.4: page 1 should hold 3 rows (got %)', page1; END IF;

  -- last page-1 row in feed order, joined to the real starts_at to drive the cursor.
  select src.starts_at, src.id into last_starts, last_id
    from _ks_p1 p join _ks_src src on src.id = p.date_instance_id
    order by src.starts_at desc, src.id desc limit 1;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _ks_p2 as
    select * from browse_feed_for_viewer(viewer, null, last_starts, last_id, 3);
  reset role;

  select count(*) into page2 from _ks_p2;
  IF page2 < 3 THEN RAISE EXCEPTION 'E23.4: page 2 should hold the next 3 rows (got %)', page2; END IF;

  -- no overlap (dup) between the two pages
  select count(*) into overlap
    from _ks_p1 a join _ks_p2 b on a.date_instance_id = b.date_instance_id;
  IF overlap <> 0 THEN RAISE EXCEPTION 'E23.4: keyset pages overlap (dup rows=%)', overlap; END IF;

  -- no skip: page1 ∪ page2 covers the first 6 in stable order with no gap.
  IF (select count(distinct date_instance_id) from (
        select date_instance_id from _ks_p1 union all select date_instance_id from _ks_p2) u) < 6 THEN
    RAISE EXCEPTION 'E23.4: keyset pagination skipped a row across the boundary';
  END IF;

  drop table _ks_src; drop table _ks_all; drop table _ks_p1; drop table _ks_p2;
  RAISE NOTICE 'E23.4: keyset no-dup/no-skip under the tuned soft-score OK';
  ROLLBACK;
END $do$;

\echo 'e23_feed_contract.sql: ALL ASSERTIONS PASSED'
