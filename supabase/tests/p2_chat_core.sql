-- supabase/tests/p2_chat_core.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE thr uuid; ready boolean;
BEGIN
  -- the four primitives must exist with the C2/C9 signatures
  PERFORM 1 FROM pg_proc WHERE proname='open_chat_thread';
  IF NOT FOUND THEN RAISE EXCEPTION 'open_chat_thread missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='close_chat_thread';
  IF NOT FOUND THEN RAISE EXCEPTION 'close_chat_thread missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='promote_chat_thread_to_lock';
  IF NOT FOUND THEN RAISE EXCEPTION 'promote_chat_thread_to_lock missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='chat_lock_ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'chat_lock_ready missing'; END IF;
  -- thread table survives profile delete (tombstone) → has revoked_at, no cascade-only design
  PERFORM 1 FROM information_schema.columns WHERE table_name='chat_threads' AND column_name='revoked_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'chat_threads.revoked_at missing (C9 legal-hold)'; END IF;
  RAISE NOTICE 'chat-core primitives OK';
END $$;
