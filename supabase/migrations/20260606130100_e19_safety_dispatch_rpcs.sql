-- supabase/migrations/20260605120100_e19_safety_dispatch_rpcs.sql
-- E19 (REQ-E19 / D-03 / D-04): the CONSUMER half of the day-of reconfirm + post-date
-- safety check-in. Two stale-tolerant DEFINER dispatch RPCs the process-jobs cron calls
-- (day_of_reconfirm -> dispatch_date_reconfirm; safety_checkin -> dispatch_safety_checkin).
--
-- SOFT POSTURE (D-03/D-04) — central safety invariant: these ONLY dispatch notifications.
-- They NEVER update locks, never auto-cancel, never enforce or escalate. A no-ack reconfirm
-- leaves locks.status UNCHANGED. The "still on?" / "all good?" surfaces are warm nudges.
--
-- POISON-LOOP SAFETY: handlers.ts callRpc THROWS on any RPC error -> backoff -> dead-letter@5.
-- So each RPC mirrors close_rating_window's never-raise posture (20260527127200:79-94): a
-- null / missing / non-active lock returns void cleanly (drains the job), never raises.
--
-- Lock-load shape copied from flag_no_show (20260604121000_e5_loop_completion.sql:137-140).
-- Dispatch signature: dispatch_notification(p_user, p_type, p_payload) — safety types
-- (date_reconfirm/safety_checkin) already bypass consent/quiet/rate inside dispatch_notification
-- (20260525123600), so there is NO extra gating here.
--
-- GATED: local apply + security advisor + the e19_safety_handlers.sql assertion run are all
-- DEFERRED to 06-05. Prod (ufufmcpnysvwtutpbian) UNTOUCHED. Producers (the enqueues in the
-- two lock RPCs) are plan 06-04 and depend on these RPCs + handlers existing.

-- ============================================================================
-- dispatch_date_reconfirm(p_lock) — the morning-of "still on?" reach-out (D-04).
-- Notifies BOTH parties. NEVER mutates lock state. Drains cleanly on a resolved lock.
-- ============================================================================
create or replace function dispatch_date_reconfirm(p_lock uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; matched uuid; inst uuid; lst lock_status;
begin
  if p_lock is null then return; end if;                       -- null guard, never raise

  select creator_id, matched_user_id, date_instance_id, status
    into cre, matched, inst, lst from locks where id=p_lock;
  if cre is null then return; end if;                          -- stale/missing: drain cleanly
  if lst <> 'active' then return; end if;                      -- cancelled/no_show/completed: no reconfirm, drain

  -- SOFT (D-04): dispatch only. No `update locks set status`, no auto-cancel, no escalation.
  perform dispatch_notification(cre,     'date_reconfirm', jsonb_build_object('lock_id', p_lock, 'instance', inst));
  perform dispatch_notification(matched, 'date_reconfirm', jsonb_build_object('lock_id', p_lock, 'instance', inst));
end $fn$;

-- ============================================================================
-- dispatch_safety_checkin(p_lock) — the post-date "all good?" ping (D-03).
-- Mirrors dispatch_date_reconfirm exactly; dispatches the safety_checkin type.
-- ============================================================================
create or replace function dispatch_safety_checkin(p_lock uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; matched uuid; inst uuid; lst lock_status;
begin
  if p_lock is null then return; end if;                       -- null guard, never raise

  select creator_id, matched_user_id, date_instance_id, status
    into cre, matched, inst, lst from locks where id=p_lock;
  if cre is null then return; end if;                          -- stale/missing: drain cleanly
  -- A post-date check-in fires AFTER the date; by then sweep_loop_terminus may have moved
  -- the lock active->completed. Check in on active AND completed dates; only a cancelled or
  -- no_show date (the date never happened) drains without a ping.
  if lst in ('cancelled', 'no_show') then return; end if;

  -- SOFT (D-03): dispatch only. No lock-state mutation, no enforcement.
  perform dispatch_notification(cre,     'safety_checkin', jsonb_build_object('lock_id', p_lock, 'instance', inst));
  perform dispatch_notification(matched, 'safety_checkin', jsonb_build_object('lock_id', p_lock, 'instance', inst));
end $fn$;

-- ============================================================================
-- Grants: handler / service-role only (these are job consumers, never client-callable).
-- ============================================================================
revoke all on function dispatch_date_reconfirm(uuid) from public, anon, authenticated;
revoke all on function dispatch_safety_checkin(uuid) from public, anon, authenticated;
