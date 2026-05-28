-- supabase/tests/p2_chat_core.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE
  cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid; lk uuid;
  t1 uuid; t2 uuid; st text; ok boolean := false;
BEGIN
  -- structure
  PERFORM 1 FROM pg_tables WHERE tablename='chat_threads' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'chat_threads missing or RLS off'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='chat_threads' AND column_name='revoked_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'chat_threads.revoked_at (C9 tombstone) missing'; END IF;

  -- fixtures: an offer to anchor the thread
  cre := mk_user('cre'); cand := mk_user('cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;

  -- open is idempotent (same offer twice -> same thread)
  t1 := open_chat_thread(off1);
  t2 := open_chat_thread(off1);
  IF t1 <> t2 THEN RAISE EXCEPTION 'open_chat_thread not idempotent: % <> %', t1, t2; END IF;

  -- chat_lock_ready (Z.1): true while state='open', false otherwise; null-safe for missing thread
  IF NOT chat_lock_ready(t1) THEN RAISE EXCEPTION 'Z.1: lock gate should be open immediately after open_chat_thread (state=open)'; END IF;
  IF chat_lock_ready(gen_random_uuid()) THEN RAISE EXCEPTION 'Z.1: lock gate should be false for missing thread'; END IF;

  -- promote on accept
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lk;
  PERFORM promote_chat_thread_to_lock(off1, lk);
  SELECT state INTO st FROM chat_threads WHERE id = t1;
  IF st <> 'promoted' THEN RAISE EXCEPTION 'promote did not set state=promoted, got %', st; END IF;

  -- Z.1: after promote, state='promoted' → chat_lock_ready returns false
  IF chat_lock_ready(t1) THEN RAISE EXCEPTION 'Z.1: lock gate should close after promote (state=promoted)'; END IF;

  -- promote on a missing offer must fail loud
  BEGIN
    PERFORM promote_chat_thread_to_lock(gen_random_uuid(), lk);
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'promote on a missing offer should have raised'; END IF;

  -- close does NOT revert a promoted thread (state guard)
  PERFORM close_chat_thread(off1);
  SELECT state INTO st FROM chat_threads WHERE id = t1;
  IF st <> 'promoted' THEN RAISE EXCEPTION 'close wrongly reverted a promoted thread to %', st; END IF;

  RAISE NOTICE 'chat-core open/ready/promote(+missing raise)/close-guard OK';
  ROLLBACK;
END $$;

-- close on an OPEN thread marks it closed + stamps revoked_at
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid; t1 uuid; st text; rv timestamptz;
BEGIN
  cre := mk_user('c_cre'); cand := mk_user('c_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;
  t1 := open_chat_thread(off1);
  PERFORM close_chat_thread(off1);
  SELECT state, revoked_at INTO st, rv FROM chat_threads WHERE id = t1;
  IF st <> 'closed' THEN RAISE EXCEPTION 'open thread should close, got %', st; END IF;
  IF rv IS NULL THEN RAISE EXCEPTION 'close should stamp revoked_at'; END IF;

  -- Z.1: after close, state='closed' → chat_lock_ready returns false
  IF chat_lock_ready(t1) THEN RAISE EXCEPTION 'Z.1: lock gate should be false after close (state=closed)'; END IF;

  RAISE NOTICE 'chat-core close-open OK';
  ROLLBACK;
END $$;

-- legal-hold survival (C9): a held thread cannot be deleted (would defeat S10 legal-hold)
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off1 uuid; t1 uuid; ok boolean := false;
BEGIN
  cre := mk_user('h_cre'); cand := mk_user('h_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into offers (date_instance_id, candidate_id, creator_id, status, expires_at)
    values (inst, cand, cre, 'active', now() + interval '1 day') returning id into off1;
  t1 := open_chat_thread(off1);
  update chat_threads set legal_hold = true where id = t1;
  BEGIN
    delete from chat_threads where id = t1;
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'a legal_hold chat_thread must NOT be deletable (C9)'; END IF;
  RAISE NOTICE 'chat-core legal-hold delete guard OK';
  ROLLBACK;
END $$;
