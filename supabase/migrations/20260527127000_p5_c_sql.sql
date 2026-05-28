-- 20260527127000_p5_c_sql.sql
-- C-SQL: the SQL deliverables of sub-project C (extras + edge transport).
-- DEFERRED: 8 Deno Edge Functions + shared _shared library + TS types regen
--           (these are Deno modules requiring per-function deploys, not SQL).
--
-- Ships:
--   1. match_demand_hint(p_instance) — swipe-count heuristic stub
--   2. feature_config row for match_v2_enabled (false default; Task 10 flips per cohort)
--   3. admin_force_expire_offer + admin_force_cancel_lock (service-role-only support tools)
--   4. prune_idempotency_ledger() — callable function (pg_cron not installed; manual/job invocation)
--   5. Centralized REVOKE pass to backstop any forgotten REVOKE in earlier migrations

-- ============================================================================
-- 1. match_demand_hint — swipe-count heuristic stub
-- ============================================================================
-- Returns one of 'quiet'|'warming_up'|'filling_up'|'almost_full' based on
-- right-swipe count for the instance. Stubbed buckets; real ML model is post-MVP.
create or replace function match_demand_hint(p_instance uuid)
returns text language sql stable security definer set search_path=public as $fn$
  select case
    when (select count(*) from swipes where date_instance_id=p_instance and direction='right') >= 30 then 'almost_full'
    when (select count(*) from swipes where date_instance_id=p_instance and direction='right') >= 15 then 'filling_up'
    when (select count(*) from swipes where date_instance_id=p_instance and direction='right') >= 5  then 'warming_up'
    else 'quiet'
  end
$fn$;

-- ============================================================================
-- 2. feature_config row for match_v2_enabled
-- ============================================================================
-- Default OFF for safety. Task 10 (rollout) flips per cohort.
insert into feature_config(key, value)
values ('match_v2_enabled', 'false'::jsonb)
on conflict (key) do nothing;
-- Note the `do nothing` — if local dev (or a prior session) already set it to 'true',
-- we don't clobber. Prod first-apply will insert with 'false'.

-- ============================================================================
-- 3. admin tooling (service-role only)
-- ============================================================================
create or replace function admin_force_expire_offer(p_offer uuid)
returns int language plpgsql security definer set search_path=public as $fn$
begin
  -- No auth.uid() check: service_role only (enforced via REVOKE below).
  return match_resolve_offer_negative(p_offer, 'expired');
end $fn$;

create or replace function admin_force_cancel_lock(p_lock uuid, p_reason text)
returns void language plpgsql security definer set search_path=public as $fn$
declare inst uuid; cre uuid; matched uuid;
begin
  -- No auth.uid() check: service_role only (enforced via REVOKE below).
  -- Treat as a non-safety cancel by 'support' (the actor field uses creator as placeholder).
  if p_reason not in ('mutual','no_show','creator_pre_lock','safety','other') then
    raise exception 'bad_reason' using errcode='22023', detail=p_reason;
  end if;
  select date_instance_id, creator_id, matched_user_id into inst, cre, matched
    from locks where id=p_lock for update;
  if inst is null then raise exception 'no_lock' using errcode='P0002'; end if;
  update locks set status='cancelled', cancelled_by=cre, cancel_reason=p_reason::cancel_reason, updated_at=now()
    where id=p_lock;
  update date_instances set status='cancelled', updated_at=now() where id=inst;
  -- Notify both parties; use lock_cancelled_rolled (admin-initiated is "rolled" not "frozen")
  perform dispatch_notification(cre, 'lock_cancelled_rolled',
    jsonb_build_object('lock_id', p_lock, 'instance', inst, 'reason', p_reason, 'by', 'admin'));
  perform dispatch_notification(matched, 'lock_cancelled_rolled',
    jsonb_build_object('lock_id', p_lock, 'instance', inst, 'reason', p_reason, 'by', 'admin'));
  insert into admin_alerts(kind, payload)
    values ('admin_force_cancel_lock',
            jsonb_build_object('lock_id', p_lock, 'reason', p_reason, 'instance', inst));
end $fn$;

-- ============================================================================
-- 4. prune_idempotency_ledger — call manually or schedule via job runner
-- ============================================================================
-- pg_cron isn't enabled in this Supabase project. Without it, the prune runs
-- via S2's job runner (a daily job_type='analytics_relay' or similar) or by
-- a manual invocation. Function below is callable by service_role.
create or replace function prune_idempotency_ledger(p_older_than interval default '30 days')
returns int language plpgsql security definer set search_path=public as $fn$
declare n int;
begin
  delete from transition_idempotency where created_at < now() - p_older_than;
  get diagnostics n = row_count;
  insert into admin_alerts(kind, payload)
    values ('idempotency_pruned',
            jsonb_build_object('rows_deleted', n, 'cutoff', (now()-p_older_than)::text));
  return n;
end $fn$;

-- ============================================================================
-- 5. Centralized REVOKE pass — backstop any earlier migration miss
-- ============================================================================
revoke all on function match_demand_hint(uuid) from public, anon;
revoke all on function admin_force_expire_offer(uuid) from public, anon, authenticated;
revoke all on function admin_force_cancel_lock(uuid, text) from public, anon, authenticated;
revoke all on function prune_idempotency_ledger(interval) from public, anon, authenticated;
