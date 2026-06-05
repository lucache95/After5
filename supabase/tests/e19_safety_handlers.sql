-- supabase/tests/e19_safety_handlers.sql
-- E19 (REQ-E19 / D-03 / D-04): the SAFETY-CRITICAL contract for the two dispatch RPCs
-- (dispatch_date_reconfirm, dispatch_safety_checkin) consumed by process-jobs.
-- SQL assertion script — the project's local-apply verification posture (no pgTAP harness
-- in-tree). RAISE EXCEPTION on any failed assertion so a non-zero psql exit signals failure.
-- EXECUTED in plan 06-05 against the local stack AFTER 20260605120100 applies; authored here.
--
-- Four safety-critical assertions:
--   (a) DISPATCH (reconfirm): active lock -> date_reconfirm notification for BOTH parties
--   (b) DISPATCH (check-in):  active lock -> safety_checkin notification for BOTH parties
--   (c) POISON-LOOP / never-raise: cancelled (non-active) lock -> RPC returns void, NO error,
--       NO new notification rows (the job drains cleanly; handlers.ts callRpc throws on error)
--   (d) NO-AUTO-CANCEL (D-04): a no-ack reconfirm on an active lock leaves locks.status
--       UNCHANGED ('active') — the RPC never mutates lock state, never enforces, never escalates
\i supabase/tests/_fixtures.sql

-- A fresh active lock between two users on a fresh dated instance. Returns the lock id.
-- Each lock needs its own instance (locks.unique(date_instance_id)).
create or replace function e19_mk_active_lock(p_cre uuid, p_matched uuid) returns uuid
language plpgsql as $$
declare itin uuid; inst uuid; lid uuid;
begin
  itin := mk_itinerary(p_cre);
  inst := mk_instance(itin, p_cre, now() + interval '6 hours');
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, p_cre, p_matched, 'active') returning id into lid;
  return lid;
end $$;

-- Count this lock's notifications of a given type for a given recipient.
create or replace function e19_notif_count(p_lock uuid, p_type notification_type, p_user uuid)
returns bigint language sql as $$
  select count(*) from notifications
   where type = p_type and user_id = p_user and (payload->>'lock_id')::uuid = p_lock;
$$;

-- ============================================================================
-- (a) DISPATCH: dispatch_date_reconfirm on an active lock notifies BOTH parties
-- ============================================================================
DO $$
DECLARE cre uuid; matched uuid; lid uuid;
BEGIN
  cre := mk_user('e19a_cre'); matched := mk_user('e19a_matched');
  lid := e19_mk_active_lock(cre, matched);

  PERFORM dispatch_date_reconfirm(lid);

  IF e19_notif_count(lid, 'date_reconfirm', cre) < 1 THEN
    RAISE EXCEPTION 'E19(a): creator must receive a date_reconfirm notification';
  END IF;
  IF e19_notif_count(lid, 'date_reconfirm', matched) < 1 THEN
    RAISE EXCEPTION 'E19(a): matched user must receive a date_reconfirm notification';
  END IF;
  RAISE NOTICE 'E19(a) OK: date_reconfirm dispatched to both parties';
END $$;

-- ============================================================================
-- (b) DISPATCH: dispatch_safety_checkin on an active lock notifies BOTH parties
-- ============================================================================
DO $$
DECLARE cre uuid; matched uuid; lid uuid;
BEGIN
  cre := mk_user('e19b_cre'); matched := mk_user('e19b_matched');
  lid := e19_mk_active_lock(cre, matched);

  PERFORM dispatch_safety_checkin(lid);

  IF e19_notif_count(lid, 'safety_checkin', cre) < 1 THEN
    RAISE EXCEPTION 'E19(b): creator must receive a safety_checkin notification';
  END IF;
  IF e19_notif_count(lid, 'safety_checkin', matched) < 1 THEN
    RAISE EXCEPTION 'E19(b): matched user must receive a safety_checkin notification';
  END IF;
  RAISE NOTICE 'E19(b) OK: safety_checkin dispatched to both parties';
END $$;

-- ============================================================================
-- (c) POISON-LOOP / never-raise: a cancelled (non-active) lock drains cleanly.
-- The RPC must return void with NO error and dispatch NO new rows. Also assert the
-- missing-lock case returns cleanly (gen_random_uuid() lock id -> drain, no raise).
-- ============================================================================
DO $$
DECLARE cre uuid; matched uuid; lid uuid; n_before bigint; n_after bigint;
BEGIN
  cre := mk_user('e19c_cre'); matched := mk_user('e19c_matched');
  lid := e19_mk_active_lock(cre, matched);
  update locks set status = 'cancelled' where id = lid;  -- resolve the lock

  n_before := e19_notif_count(lid, 'date_reconfirm', cre) + e19_notif_count(lid, 'date_reconfirm', matched);

  -- must NOT raise on a cancelled lock (would dead-letter@5 via callRpc throw)
  PERFORM dispatch_date_reconfirm(lid);
  PERFORM dispatch_safety_checkin(lid);
  -- must NOT raise on a missing lock either
  PERFORM dispatch_date_reconfirm(gen_random_uuid());
  PERFORM dispatch_date_reconfirm(null);

  n_after := e19_notif_count(lid, 'date_reconfirm', cre) + e19_notif_count(lid, 'date_reconfirm', matched);
  IF n_after <> n_before THEN
    RAISE EXCEPTION 'E19(c): cancelled lock must dispatch NO new notifications (poison-loop), before=% after=%', n_before, n_after;
  END IF;
  RAISE NOTICE 'E19(c) OK: cancelled/missing/null lock drains cleanly, no raise, no new rows';
END $$;

-- ============================================================================
-- (d) NO-AUTO-CANCEL (D-04): a no-ack reconfirm leaves locks.status UNCHANGED.
-- Dispatch the reconfirm on an active lock and never ack it -> status stays 'active'.
-- The dispatch RPCs are notify-only; they must NEVER mutate lock state.
-- ============================================================================
DO $$
DECLARE cre uuid; matched uuid; lid uuid; st lock_status;
BEGIN
  cre := mk_user('e19d_cre'); matched := mk_user('e19d_matched');
  lid := e19_mk_active_lock(cre, matched);

  PERFORM dispatch_date_reconfirm(lid);  -- simulate a no-ack reconfirm (nobody replies)

  SELECT status INTO st FROM locks WHERE id = lid;
  IF st IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'E19(d): a no-ack reconfirm must NOT change lock status (soft D-04), got %', st;
  END IF;
  RAISE NOTICE 'E19(d) OK: no-ack reconfirm leaves locks.status unchanged (still active)';
END $$;

-- cleanup helpers
drop function if exists e19_mk_active_lock(uuid, uuid);
drop function if exists e19_notif_count(uuid, notification_type, uuid);
