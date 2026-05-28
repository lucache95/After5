-- supabase/tests/a_idempotency.sql
-- A.2: transition_idempotency ledger behavior + REVOKE verification.
\i supabase/tests/_fixtures.sql
DO $$
DECLARE u uuid; k uuid; r1 jsonb; r2 jsonb;
BEGIN
  u := mk_user('idem_actor');
  k := gen_random_uuid();

  -- lookup on empty returns null
  r1 := match_idem_lookup(u, 'accept_offer', k);
  IF r1 IS NOT NULL THEN RAISE EXCEPTION 'A.2: lookup on empty must return null, got %', r1; END IF;

  -- store + lookup returns the stored jsonb
  PERFORM match_idem_store(u, 'accept_offer', k, '{"lock_id":"abc"}'::jsonb);
  r1 := match_idem_lookup(u, 'accept_offer', k);
  IF r1 IS NULL OR r1->>'lock_id' <> 'abc' THEN
    RAISE EXCEPTION 'A.2: store/lookup roundtrip failed, got %', r1;
  END IF;

  -- second store with same key is a no-op (on conflict do nothing)
  PERFORM match_idem_store(u, 'accept_offer', k, '{"lock_id":"OVERWRITTEN"}'::jsonb);
  r2 := match_idem_lookup(u, 'accept_offer', k);
  IF r2->>'lock_id' <> 'abc' THEN
    RAISE EXCEPTION 'A.2: second store should NOT overwrite (got %)', r2;
  END IF;

  -- different action with same key is independent
  r1 := match_idem_lookup(u, 'cancel_lock', k);
  IF r1 IS NOT NULL THEN RAISE EXCEPTION 'A.2: cross-action key isolation failed'; END IF;

  RAISE NOTICE 'A.2: idempotency ledger OK';
  ROLLBACK;
END $$;

-- Negative-authz: REVOKE FROM authenticated/anon verified via metadata
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.match_idem_lookup(uuid,text,uuid)', 'execute') THEN
    RAISE EXCEPTION 'A.2: authenticated MUST NOT have execute on match_idem_lookup';
  END IF;
  IF has_function_privilege('authenticated', 'public.match_idem_store(uuid,text,uuid,jsonb)', 'execute') THEN
    RAISE EXCEPTION 'A.2: authenticated MUST NOT have execute on match_idem_store';
  END IF;
  RAISE NOTICE 'A.2: idempotency-helpers negative-authz OK';
END $$;
