-- supabase/tests/c_job_handler_rpcs.sql
-- Handler<->RPC existence guard. The job runner
-- (supabase/functions/process-jobs/handlers.ts) dispatches each job_type to a
-- Postgres RPC. If a LIVE-enqueued job type names an RPC that does not exist with
-- the called argument signature, that job poison-loops (errors + retries forever).
-- This test asserts every LIVE-enqueued job type's RPC exists with the exact
-- arg signature the handler invokes.
--
-- LIVE-enqueued job types (enqueued somewhere in 5b, so they WILL fire):
--   offer_expiry  -> match_expire_offer(uuid)
--   standby_roll  -> match_auto_roll(uuid)
--   bulk_withdraw -> match_bulk_withdraw(uuid)
--   rating_window -> close_rating_window(uuid)
--
-- KNOWN-PENDING / DORMANT handlers (their job types are NOT enqueued anywhere in
-- 5b yet; they belong to future phases and are intentionally NOT guarded here):
--   stale_date_close  -> match_stale_date_close(uuid)   (P5/S6)
--   pending_expiry    -> match_expire_pending(uuid)     (P5/S6)
--   reconfirm_timeout -> match_reconfirm_timeout(uuid)  (S6)
--   chat_purge        -> chat_purge_thread(uuid)        (P6/S7)
--   deletion_process  -> process_deletion(uuid)         (P9/S10)
--   analytics_relay   -> analytics_relay_drain(jsonb)   (P11/S12)
-- When those phases land, add their signatures to the guard below.
\i supabase/tests/_fixtures.sql

DO $$
DECLARE
  sigs text[] := ARRAY[
    'match_expire_offer(uuid)',
    'match_auto_roll(uuid)',
    'match_bulk_withdraw(uuid)',
    'close_rating_window(uuid)'
  ];
  s text;
BEGIN
  FOREACH s IN ARRAY sigs LOOP
    -- to_regprocedure returns NULL if no function with that exact signature exists.
    IF to_regprocedure(s) IS NULL THEN
      RAISE EXCEPTION 'c_job_handler_rpcs: LIVE-enqueued handler RPC % does not exist (poison-loop risk)', s;
    END IF;
    RAISE NOTICE 'c_job_handler_rpcs: % exists OK', s;
  END LOOP;
END $$;

DO $$ BEGIN RAISE NOTICE 'c_job_handler_rpcs: all live-enqueued handler RPCs present OK'; END $$;
