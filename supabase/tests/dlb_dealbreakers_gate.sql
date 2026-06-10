-- supabase/tests/dlb_dealbreakers_gate.sql
-- DLB-01/DLB-02: the mutual dealbreaker gate in browse_feed_for_viewer.
--
-- Asserts:
--   1. dealbreaker_blocks truth table — all 7 tag→fact mappings block on the
--      offending value, NULL facts NEVER block, wrong-polarity facts pass,
--      empty/NULL dealbreakers block nothing.
--   2. Viewer-side gate: a viewer with the 'smoking' hard no stops seeing a
--      smokes=true host's night; a smokes=NULL host (unanswered) and a
--      smokes=false host still show.
--   3. Host-side MIRROR: a host with the 'smoking' hard no is hidden from a
--      smokes=true viewer, but still shown to a smokes=NULL viewer.
--   4. Empty dealbreakers on both sides = no change, even with "offending" facts.
--
-- Harness mirrors e23_feed_contract.sql: \i _fixtures.sql, jwt-claims,
-- SET LOCAL ROLE authenticated, positional RPC, ROLLBACK per block.
\i supabase/tests/_fixtures.sql

-- ── 1. dealbreaker_blocks truth table (pure function, superuser) ──────────────
DO $do$
BEGIN
  -- every tag blocks its offending fact value
  IF NOT dealbreaker_blocks(array['smoking'],        true,  null, null, null) THEN RAISE EXCEPTION 'DLB.1: smoking must block smokes=true'; END IF;
  IF NOT dealbreaker_blocks(array['drinks_alcohol'], null,  true, null, null) THEN RAISE EXCEPTION 'DLB.1: drinks_alcohol must block drinks=true'; END IF;
  IF NOT dealbreaker_blocks(array['no_alcohol'],     null, false, null, null) THEN RAISE EXCEPTION 'DLB.1: no_alcohol must block drinks=false'; END IF;
  IF NOT dealbreaker_blocks(array['has_pets'],       null,  null, true, null) THEN RAISE EXCEPTION 'DLB.1: has_pets must block has_pets=true'; END IF;
  IF NOT dealbreaker_blocks(array['no_pets'],        null,  null, false,null) THEN RAISE EXCEPTION 'DLB.1: no_pets must block has_pets=false'; END IF;
  IF NOT dealbreaker_blocks(array['wants_kids'],     null,  null, null, true) THEN RAISE EXCEPTION 'DLB.1: wants_kids must block wants_kids=true'; END IF;
  IF NOT dealbreaker_blocks(array['no_kids'],        null,  null, null, false) THEN RAISE EXCEPTION 'DLB.1: no_kids must block wants_kids=false'; END IF;

  -- NULL facts NEVER block (both polarities of the kids/alcohol/pets pairs)
  IF dealbreaker_blocks(array['smoking','drinks_alcohol','no_alcohol','has_pets','no_pets','wants_kids','no_kids'],
                        null, null, null, null) THEN
    RAISE EXCEPTION 'DLB.1: NULL facts must never block, even with every tag set';
  END IF;

  -- wrong polarity passes
  IF dealbreaker_blocks(array['smoking'],    false, null, null, null) THEN RAISE EXCEPTION 'DLB.1: smoking must pass smokes=false'; END IF;
  IF dealbreaker_blocks(array['no_alcohol'], null,  true, null, null) THEN RAISE EXCEPTION 'DLB.1: no_alcohol must pass drinks=true'; END IF;
  IF dealbreaker_blocks(array['no_kids'],    null,  null, null, true) THEN RAISE EXCEPTION 'DLB.1: no_kids must pass wants_kids=true'; END IF;

  -- empty / NULL dealbreakers block nothing, even with every fact "offending"
  IF dealbreaker_blocks('{}'::text[], true, true, true, true) THEN RAISE EXCEPTION 'DLB.1: empty dealbreakers must block nothing'; END IF;
  IF dealbreaker_blocks(null,         true, true, true, true) THEN RAISE EXCEPTION 'DLB.1: NULL dealbreakers must block nothing'; END IF;

  RAISE NOTICE 'DLB.1: dealbreaker_blocks truth table OK';
END $do$;

-- shared seeding shorthand for blocks 2-4: a verified, dating-on Kelowna profile.
create or replace function dlb_ready(p_user uuid, p_gender text, p_wants text) returns void language plpgsql as $$
declare kel uuid;
begin
  select id into kel from cities where slug='kelowna';
  insert into profiles_private(user_id, birthdate) values (p_user, (now()-interval '30 years')::date)
    on conflict(user_id) do update set birthdate = excluded.birthdate;
  update profiles set gender=p_gender, gender_preferences=array[p_wants], age=30,
    age_pref=int4range(18,99), distance_pref_km=150, primary_city_id=kel,
    verification='verified', dating_enabled=true where id=p_user;
end $$;

-- ── 2. viewer-side gate: 'smoking' hard no vs smokes=true / NULL / false hosts ─
DO $do$
DECLARE viewer uuid; h_smoker uuid; h_unknown uuid; h_clean uuid;
        i_smoker uuid; i_unknown uuid; i_clean uuid; itin uuid; n int;
BEGIN
  viewer    := mk_user('dlb2_viewer');
  h_smoker  := mk_user('dlb2_h_smoker');
  h_unknown := mk_user('dlb2_h_unknown');
  h_clean   := mk_user('dlb2_h_clean');
  PERFORM dlb_ready(viewer, 'woman', 'man');
  PERFORM dlb_ready(h_smoker,  'man', 'woman');
  PERFORM dlb_ready(h_unknown, 'man', 'woman');
  PERFORM dlb_ready(h_clean,   'man', 'woman');

  update profiles set dealbreakers = array['smoking'] where id = viewer;
  update profiles set smokes = true  where id = h_smoker;
  -- h_unknown: smokes stays NULL (unanswered)
  update profiles set smokes = false where id = h_clean;

  itin := mk_itinerary(h_smoker);  i_smoker  := mk_instance(itin, h_smoker,  now()+interval '1 day');
  itin := mk_itinerary(h_unknown); i_unknown := mk_instance(itin, h_unknown, now()+interval '2 days');
  itin := mk_itinerary(h_clean);   i_clean   := mk_instance(itin, h_clean,   now()+interval '3 days');
  update date_instances set moderation_status='approved'
    where id in (i_smoker, i_unknown, i_clean);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  create temp table _dlb2 as select * from browse_feed_for_viewer(viewer, null, null, null, 50);
  reset role;

  IF exists (select 1 from _dlb2 where date_instance_id = i_smoker) THEN
    RAISE EXCEPTION 'DLB.2: smoking hard no must EXCLUDE the smokes=true host''s night';
  END IF;
  select count(*) into n from _dlb2 where date_instance_id in (i_unknown, i_clean);
  IF n <> 2 THEN
    RAISE EXCEPTION 'DLB.2: smokes=NULL (unanswered) and smokes=false hosts must still show (got % of 2)', n;
  END IF;
  drop table _dlb2;
  RAISE NOTICE 'DLB.2: viewer-side gate (exclude offender, NULL+clean pass) OK';
  ROLLBACK;
END $do$;

-- ── 3. host-side MIRROR: host hard no trips on the VIEWER's facts ─────────────
DO $do$
DECLARE v_smoker uuid; v_unknown uuid; host uuid; itin uuid; inst uuid; seen boolean;
BEGIN
  v_smoker  := mk_user('dlb3_v_smoker');
  v_unknown := mk_user('dlb3_v_unknown');
  host      := mk_user('dlb3_host');
  PERFORM dlb_ready(v_smoker,  'woman', 'man');
  PERFORM dlb_ready(v_unknown, 'woman', 'man');
  PERFORM dlb_ready(host, 'man', 'woman');

  update profiles set dealbreakers = array['smoking'] where id = host;
  update profiles set smokes = true where id = v_smoker;
  -- v_unknown: smokes stays NULL

  itin := mk_itinerary(host);
  inst := mk_instance(itin, host, now()+interval '1 day');
  update date_instances set moderation_status='approved' where id = inst;

  -- the smoking viewer must NOT see the night (host's hard no mirrors back)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',v_smoker,'role','authenticated')::text, true);
  select exists (select 1 from browse_feed_for_viewer(v_smoker, null, null, null, 50)
                 where date_instance_id = inst) into seen;
  reset role;
  IF seen THEN
    RAISE EXCEPTION 'DLB.3: host''s smoking hard no must HIDE the night from a smokes=true viewer';
  END IF;

  -- the unanswered viewer still sees it (NULL fact never trips the mirror)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',v_unknown,'role','authenticated')::text, true);
  select exists (select 1 from browse_feed_for_viewer(v_unknown, null, null, null, 50)
                 where date_instance_id = inst) into seen;
  reset role;
  IF NOT seen THEN
    RAISE EXCEPTION 'DLB.3: a smokes=NULL viewer must still see the hard-no host''s night';
  END IF;

  RAISE NOTICE 'DLB.3: host-side mirror (offending viewer hidden, NULL viewer passes) OK';
  ROLLBACK;
END $do$;

-- ── 4. empty dealbreakers = no change, even with fully "offending" facts ──────
DO $do$
DECLARE viewer uuid; host uuid; itin uuid; inst uuid; seen boolean;
BEGIN
  viewer := mk_user('dlb4_viewer');
  host   := mk_user('dlb4_host');
  PERFORM dlb_ready(viewer, 'woman', 'man');
  PERFORM dlb_ready(host, 'man', 'woman');

  -- both sides answered everything "offending"; neither set any hard no
  update profiles set smokes=true, drinks=true, has_pets=true, wants_kids=true,
    dealbreakers='{}' where id in (viewer, host);

  itin := mk_itinerary(host);
  inst := mk_instance(itin, host, now()+interval '1 day');
  update date_instances set moderation_status='approved' where id = inst;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',viewer,'role','authenticated')::text, true);
  select exists (select 1 from browse_feed_for_viewer(viewer, null, null, null, 50)
                 where date_instance_id = inst) into seen;
  reset role;

  IF NOT seen THEN
    RAISE EXCEPTION 'DLB.4: with empty dealbreakers the facts alone must filter NOTHING';
  END IF;
  RAISE NOTICE 'DLB.4: empty dealbreakers = no filtering OK';
  ROLLBACK;
END $do$;

drop function if exists dlb_ready(uuid, text, text);
\echo 'dlb_dealbreakers_gate.sql: ALL ASSERTIONS PASSED'
