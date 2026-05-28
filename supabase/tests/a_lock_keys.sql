-- supabase/tests/a_lock_keys.sql
-- A.1: verify advisory-lock-key helpers are present + deterministic.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u1 uuid; u2 uuid; inst uuid;
  k1a bigint; k1b bigint; k2 bigint; k3 bigint; k_inst bigint;
BEGIN
  u1 := gen_random_uuid();
  u2 := gen_random_uuid();
  inst := gen_random_uuid();

  -- match_pair_lock_key: order-independent
  k1a := match_pair_lock_key(u1, u2);
  k1b := match_pair_lock_key(u2, u1);
  IF k1a <> k1b THEN RAISE EXCEPTION 'A.1: match_pair_lock_key not order-independent (% <> %)', k1a, k1b; END IF;

  -- different pairs → different keys (collision astronomically unlikely)
  k2 := match_pair_lock_key(u1, gen_random_uuid());
  IF k1a = k2 THEN RAISE EXCEPTION 'A.1: match_pair_lock_key collision on different pair'; END IF;

  -- match_instance_lock_key: deterministic per uuid
  k_inst := match_instance_lock_key(inst);
  IF k_inst <> match_instance_lock_key(inst) THEN
    RAISE EXCEPTION 'A.1: match_instance_lock_key not deterministic';
  END IF;
  IF k_inst = match_instance_lock_key(gen_random_uuid()) THEN
    RAISE EXCEPTION 'A.1: match_instance_lock_key collision on different instance';
  END IF;

  -- Instance key != pair key for same uuids (different hash inputs)
  IF k_inst = match_pair_lock_key(inst, inst) THEN
    RAISE EXCEPTION 'A.1: instance and pair keys collide for same uuid';
  END IF;

  -- temp_race table present
  PERFORM 1 FROM pg_tables WHERE schemaname='public' AND tablename='temp_race';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.1: temp_race scaffolding table missing'; END IF;

  RAISE NOTICE 'A.1: lock keys + temp_race OK';
  ROLLBACK;
END $$;
