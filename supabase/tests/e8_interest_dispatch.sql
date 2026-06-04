-- supabase/tests/e8_interest_dispatch.sql
-- REQ-E8 (D-07): match_ingest_interest dispatches interest_received to the host ONLY when a
--   genuinely new interested candidate is enqueued (n>0), deep-linked via payload.date_instance_id.
--     right-swipe (n=1)              -> exactly one creator interest_received; payload.date_instance_id=inst.
--     re-ingest, no new swiper (n=0) -> NO additional notification row (re-ingest is a no-op).
--     a second distinct candidate    -> another enqueue (n=1); the in-app dedup short-circuit
--                                       collapses repeat deliveries on the coarse per-instance key.
--     creator-null guard             -> never dispatch when the night has no creator.
--
-- Conventions: psql assertions (NOT pgTAP) — \i fixtures, DO blocks, RAISE on failed assert,
-- ROLLBACK per case. match_ingest_interest is revoked from public/authenticated; psql connects
-- as superuser (postgres) so the direct PERFORM bypasses the grant, mirroring record_swipe DEFINER.
-- Swipes are inserted directly (the same rows record_swipe would have written before the hook fires).
\i supabase/tests/_fixtures.sql

-- ============================================================================
-- HAPPY PATH: first right-swipe (n=1) dispatches exactly one interest_received to the creator,
-- payload.date_instance_id = the night; re-ingest with no new swiper (n=0) adds no row.
-- ============================================================================
DO $$
DECLARE cre uuid; cand uuid; cand2 uuid; it uuid; inst uuid; n int; cnt int; di text;
BEGIN
  cre   := mk_user('e8h_cre');
  cand  := mk_user('e8h_cand');
  cand2 := mk_user('e8h_cand2');
  it    := mk_itinerary(cre);
  inst  := mk_instance(it, cre, now() + interval '2 days');

  -- candidate right-swipes (the row record_swipe writes before invoking the hook)
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand, inst, cre, 'right');

  -- first ingest enqueues the candidate (n=1) and must dispatch one interest_received
  n := match_ingest_interest(inst);
  IF n <> 1 THEN RAISE EXCEPTION 'E8: first ingest should enqueue 1; got %', n; END IF;

  SELECT count(*) INTO cnt FROM notifications WHERE user_id=cre AND type='interest_received';
  IF cnt <> 1 THEN RAISE EXCEPTION 'E8: n>0 must dispatch exactly 1 interest_received to creator; got %', cnt; END IF;

  -- payload carries the night id (the inbox group key + deep-link source)
  SELECT payload->>'date_instance_id' INTO di FROM notifications
    WHERE user_id=cre AND type='interest_received' LIMIT 1;
  IF di IS DISTINCT FROM inst::text THEN
    RAISE EXCEPTION 'E8: payload.date_instance_id must be the night (% ) ; got %', inst, di;
  END IF;

  -- the dedup_key is the coarse per-instance throttle key
  PERFORM 1 FROM notifications
    WHERE user_id=cre AND type='interest_received' AND dedup_key='interest_received:'||inst::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'E8: interest_received must carry per-instance dedup_key'; END IF;

  -- RE-INGEST with no new swiper: n=0, NO additional notification row (re-ingest is a no-op)
  n := match_ingest_interest(inst);
  IF n <> 0 THEN RAISE EXCEPTION 'E8: re-ingest with no new swiper should be n=0; got %', n; END IF;

  SELECT count(*) INTO cnt FROM notifications WHERE user_id=cre AND type='interest_received';
  IF cnt <> 1 THEN RAISE EXCEPTION 'E8: re-ingest (n=0) must NOT add a duplicate; count now %', cnt; END IF;

  -- a SECOND distinct candidate right-swipes -> n=1 again; the coarse dedup_key collapses the
  -- delivery to the existing (type, dedup_key) row (dispatch_notification short-circuit), so the
  -- host's interest_received row count stays 1 while demand still groups in the inbox.
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
    values (cand2, inst, cre, 'right');
  n := match_ingest_interest(inst);
  IF n <> 1 THEN RAISE EXCEPTION 'E8: a new distinct candidate should enqueue 1; got %', n; END IF;

  SELECT count(*) INTO cnt FROM notifications WHERE user_id=cre AND type='interest_received';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'E8: coarse per-instance dedup_key must collapse repeats to one row; got %', cnt;
  END IF;

  RAISE NOTICE 'E8: n>0 dispatch + payload deep-link + n=0 no-dup + coarse dedup OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- CREATOR-NULL GUARD: when the night has no creator (cre is null), never dispatch.
-- date_instances.creator_id is NOT NULL and swipes FK-require a real instance, so the only
-- faithful way cre resolves null is an instance id that isn't in date_instances. That path
-- also yields n=0 (no swipes to enqueue); the guard must hold either way (no dispatch).
-- ============================================================================
DO $$
DECLARE missing uuid := gen_random_uuid(); n int; cnt int;
BEGIN
  n := match_ingest_interest(missing);  -- cre is null, n=0

  IF n <> 0 THEN RAISE EXCEPTION 'E8: ingest on a non-existent night should be n=0; got %', n; END IF;

  -- no creator -> the guard skips dispatch entirely; no interest_received for this id
  SELECT count(*) INTO cnt FROM notifications
    WHERE type='interest_received' AND (payload->>'date_instance_id')=missing::text;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'E8: creator-null night must never dispatch interest_received; got %', cnt;
  END IF;

  RAISE NOTICE 'E8: creator-null guard OK (no dispatch)';
  ROLLBACK;
END $$;
