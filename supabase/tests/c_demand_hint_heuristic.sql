-- supabase/tests/c_demand_hint_heuristic.sql
-- C-SQL: match_demand_hint(p_instance) swipe-count heuristic.
-- VERIFIED against migration 20260527127000_p5_c_sql.sql: the function counts
-- rows in `swipes` WHERE date_instance_id=p_instance AND direction='right'.
-- Thresholds (>=): 30→almost_full, 15→filling_up, 5→warming_up, else→quiet.
-- swipes has UNIQUE(swiper_id, date_instance_id) so each right-swipe needs a
-- distinct swiper profile. The swipes_creator_id_fkey + RLS insert-check require
-- creator_id = the instance's creator_id; we insert as table owner (no RLS) so we
-- just satisfy the FKs.
\i supabase/tests/_fixtures.sql

-- Seed N distinct right-swipers against one instance, return the demand hint.
create or replace function _seed_swipes_and_hint(p_count int) returns text language plpgsql as $$
declare cre uuid; itin uuid; inst uuid; sw uuid; i int; hint text;
begin
  cre := mk_user('dh_cre');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  for i in 1..p_count loop
    sw := mk_user('dh_swiper_'||i);
    insert into swipes(swiper_id, date_instance_id, creator_id, direction)
      values (sw, inst, cre, 'right');
  end loop;
  select match_demand_hint(inst) into hint;
  return hint;
end $$;

-- Boundary table: exact threshold counts and the band each must produce.
DO $$
DECLARE got text;
BEGIN
  -- 0 right-swipes → quiet (else branch)
  got := _seed_swipes_and_hint(0);
  IF got <> 'quiet' THEN RAISE EXCEPTION 'C.demand_hint: count=0 expected quiet, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: count=0 -> quiet OK';
  ROLLBACK;
END $$;

DO $$
DECLARE got text;
BEGIN
  -- 4 right-swipes → still quiet (just below warming_up boundary)
  got := _seed_swipes_and_hint(4);
  IF got <> 'quiet' THEN RAISE EXCEPTION 'C.demand_hint: count=4 expected quiet, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: count=4 -> quiet OK';
  ROLLBACK;
END $$;

DO $$
DECLARE got text;
BEGIN
  -- 5 right-swipes → warming_up (lower boundary)
  got := _seed_swipes_and_hint(5);
  IF got <> 'warming_up' THEN RAISE EXCEPTION 'C.demand_hint: count=5 expected warming_up, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: count=5 -> warming_up OK';
  ROLLBACK;
END $$;

DO $$
DECLARE got text;
BEGIN
  -- 14 right-swipes → still warming_up (just below filling_up boundary)
  got := _seed_swipes_and_hint(14);
  IF got <> 'warming_up' THEN RAISE EXCEPTION 'C.demand_hint: count=14 expected warming_up, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: count=14 -> warming_up OK';
  ROLLBACK;
END $$;

DO $$
DECLARE got text;
BEGIN
  -- 15 right-swipes → filling_up (lower boundary)
  got := _seed_swipes_and_hint(15);
  IF got <> 'filling_up' THEN RAISE EXCEPTION 'C.demand_hint: count=15 expected filling_up, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: count=15 -> filling_up OK';
  ROLLBACK;
END $$;

DO $$
DECLARE got text;
BEGIN
  -- 29 right-swipes → still filling_up (just below almost_full boundary)
  got := _seed_swipes_and_hint(29);
  IF got <> 'filling_up' THEN RAISE EXCEPTION 'C.demand_hint: count=29 expected filling_up, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: count=29 -> filling_up OK';
  ROLLBACK;
END $$;

DO $$
DECLARE got text;
BEGIN
  -- 30 right-swipes → almost_full (lower boundary)
  got := _seed_swipes_and_hint(30);
  IF got <> 'almost_full' THEN RAISE EXCEPTION 'C.demand_hint: count=30 expected almost_full, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: count=30 -> almost_full OK';
  ROLLBACK;
END $$;

-- Direction discrimination: 'left' swipes must NOT count toward the heuristic.
DO $$
DECLARE cre uuid; itin uuid; inst uuid; sw uuid; i int; got text;
BEGIN
  cre := mk_user('dh_dir_cre');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  -- 10 LEFT swipes (should be ignored) + 5 RIGHT swipes (counts) → warming_up
  for i in 1..10 loop
    sw := mk_user('dh_left_'||i);
    insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (sw, inst, cre, 'left');
  end loop;
  for i in 1..5 loop
    sw := mk_user('dh_right_'||i);
    insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (sw, inst, cre, 'right');
  end loop;
  select match_demand_hint(inst) into got;
  IF got <> 'warming_up' THEN
    RAISE EXCEPTION 'C.demand_hint: left swipes must not count; 5 right expected warming_up, got %', got;
  END IF;
  RAISE NOTICE 'C.demand_hint: left swipes excluded (5 right -> warming_up) OK';
  ROLLBACK;
END $$;

-- Instance scoping: swipes on a different instance must NOT leak in.
DO $$
DECLARE cre uuid; itin uuid; inst_a uuid; inst_b uuid; sw uuid; i int; got text;
BEGIN
  cre := mk_user('dh_scope_cre');
  itin := mk_itinerary(cre);
  inst_a := mk_instance(itin, cre, now() + interval '2 days');
  inst_b := mk_instance(itin, cre, now() + interval '3 days');
  -- 30 right swipes on inst_b, none on inst_a → inst_a must be quiet
  for i in 1..30 loop
    sw := mk_user('dh_scope_'||i);
    insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (sw, inst_b, cre, 'right');
  end loop;
  select match_demand_hint(inst_a) into got;
  IF got <> 'quiet' THEN RAISE EXCEPTION 'C.demand_hint: instance scoping leaked; inst_a expected quiet, got %', got; END IF;
  RAISE NOTICE 'C.demand_hint: instance scoping (inst_a quiet) OK';
  ROLLBACK;
END $$;

DO $$ BEGIN RAISE NOTICE 'C.demand_hint: all heuristic + scoping assertions OK'; END $$;
