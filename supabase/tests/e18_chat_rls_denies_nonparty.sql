-- supabase/tests/e18_chat_rls_denies_nonparty.sql
-- E18 (REQ-E18): VERIFY the already-existing chat_threads_party_read RLS denies a
-- non-party SELECT. This script does NOT create or drop any policy — chat_threads_party_read
-- + chat_thread_party() shipped in Phase 7 (20260601100100_p7_chat_rls_party_read.sql).
-- Re-creating the policy without `drop policy if exists` throws duplicate_object, so the
-- E18 task is verify-only (RESEARCH Pitfall 5 / threat T-06-06, T-06-07).
--
-- SQL assertion script — the project's local-apply verification posture (no pgTAP
-- harness in-tree). RAISE EXCEPTION on any failed assertion so a non-zero psql exit
-- signals failure. EXECUTED in plan 06-05 against the local stack after migrations
-- apply; this file is authored here only.
--
-- Covers (under the real `authenticated` role + request.jwt.claims sub):
--   (a) a non-party uid SELECTing the thread by id -> 0 rows (deny)
--   (b) the creator party uid -> 1 row (allow)
--   (c) the candidate party uid -> 1 row (allow)
\i supabase/tests/_fixtures.sql

-- Guard: this script must never re-create or drop the policy. (Self-check mirroring the
-- grep gate in 06-02; the policy + helper must pre-exist from Phase 7.)
DO $$ BEGIN
  ASSERT (select count(*) from pg_policies
          where schemaname='public' and tablename='chat_threads'
            and policyname='chat_threads_party_read') = 1,
    'chat_threads_party_read must already exist (Phase 7) — E18 is verify-only, not create';
  ASSERT (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where c.relname='chat_threads' and n.nspname='public'),
    'chat_threads must have RLS enabled';
  RAISE NOTICE 'E18: chat_threads_party_read present + RLS enabled OK';
END $$;

-- deny-non-party / allow-party under the live policy.
DO $$
DECLARE
  cre uuid; cand uuid; outsider uuid; itin uuid; inst uuid; oid uuid; tid uuid;
  n int;
BEGIN
  cre := mk_user('e18_cre'); cand := mk_user('e18_cand'); outsider := mk_user('e18_outsider');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- Seed the offer + open thread directly (service-role/owner SETUP write — the policy
  -- under test is the SELECT path, not the write path). chat_thread_party() derives the
  -- parties from offer.creator_id + offer.candidate_id.
  insert into offers (date_instance_id, creator_id, candidate_id, status, expires_at)
    values (inst, cre, cand, 'active', now() + interval '1 day') returning id into oid;
  insert into chat_threads (offer_id, state) values (oid, 'open') returning id into tid;

  -- (a) non-party SELECT -> 0 rows (deny).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', outsider::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_threads WHERE id = tid;
  IF n <> 0 THEN
    RAISE EXCEPTION 'E18(a): non-party must NOT read the thread (saw % rows)', n;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'E18(a) OK: non-party denied (0 rows)';

  -- (b) creator party SELECT -> 1 row (allow).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_threads WHERE id = tid;
  IF n <> 1 THEN
    RAISE EXCEPTION 'E18(b): creator party must read the thread (saw % rows)', n;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'E18(b) OK: creator party allowed (1 row)';

  -- (c) candidate party SELECT -> 1 row (allow).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_threads WHERE id = tid;
  IF n <> 1 THEN
    RAISE EXCEPTION 'E18(c): candidate party must read the thread (saw % rows)', n;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'E18(c) OK: candidate party allowed (1 row)';
END $$;
