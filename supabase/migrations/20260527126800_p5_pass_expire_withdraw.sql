-- 20260527126800_p5_pass_expire_withdraw.sql
-- B-lite: the user-facing negative transitions (pass, expire, withdraw) + internal helper.
--
-- SCOPE REDUCTION: this migration ships ONLY pass/expire/withdraw + match_resolve_offer_negative.
-- DEFERRED to a follow-on B migration (need real auto-roll + cascade cancellation):
--   - match_auto_roll (called from resolve_negative — STUBBED here as no-op so resolve still works)
--   - match_autoclose_creator_conflicts / match_autowithdraw_user_conflicts (consumers of A.5's
--     standby_roll jobs; if not deployed, those jobs accumulate but don't break correctness)
--   - match_cancel_lock with safety-atomicity branch (cancel reasons, lock_status transitions,
--     bulk_withdraw enqueue, standing updates)
--   - match_resolve_reciprocal + reciprocal_pairs table
--
-- match_auto_roll STUB: returns null, no-op. This means a passed/expired offer does NOT
-- automatically promote the next standby. UI may show "no current offer" until creator
-- manually makes a new offer to another candidate. Acceptable for 5b's pre-launch state.
-- The real auto_roll lands in a follow-on B migration.

-- B-lite stub for match_auto_roll
create or replace function match_auto_roll(p_instance uuid)
returns uuid language sql immutable as $fn$
  select null::uuid -- B-lite stub: real implementation in follow-on B migration
$fn$;

-- INTERNAL: resolve an active offer to a terminal negative state, close chat, then (stub) auto-roll.
create or replace function match_resolve_offer_negative(p_offer uuid, p_terminal offer_status)
returns int language plpgsql security definer set search_path=public as $fn$
declare inst uuid; cand uuid; ostatus offer_status;
begin
  select date_instance_id, candidate_id, status into inst, cand, ostatus from offers where id=p_offer;
  if inst is null then return 0; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(inst));
  select status into ostatus from offers where id=p_offer for update;
  if ostatus <> 'active' then return 0; end if;

  update offers set status=p_terminal, resolved_at=now() where id=p_offer;
  -- queue_entries: pass → offer_passed; expire → offer_expired; both → eventually standby per spec
  update queue_entries
     set status = case when p_terminal='passed' then 'offer_passed'::queue_status
                       else 'offer_expired'::queue_status end,
         updated_at = now()
   where date_instance_id=inst and candidate_id=cand;

  perform close_chat_thread(p_offer);
  perform cancel_jobs('offer_expiry', p_offer::text);

  -- Dispatch the type-appropriate notification
  if p_terminal = 'passed' then
    perform dispatch_notification(cand, 'offer_passed', jsonb_build_object('offer_id', p_offer, 'instance', inst));
  else
    perform dispatch_notification(cand, 'offer_expired', jsonb_build_object('offer_id', p_offer, 'instance', inst));
  end if;

  -- Auto-roll the instance (B-lite: no-op stub)
  perform match_auto_roll(inst);
  return 1;
end $fn$;

-- C2 PUBLIC: offer-holder declines.
create or replace function match_pass_offer(p_actor uuid, p_offer uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare cand uuid;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;
  select candidate_id into cand from offers where id=p_offer;
  if cand is null then raise exception 'no_offer' using errcode='P0002'; end if;
  if cand <> p_actor then raise exception 'not_offer_holder' using errcode='42501'; end if;
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_offer_passed', p_actor, 'offer', p_offer, jsonb_build_object());
  return match_resolve_offer_negative(p_offer, 'passed');
end $fn$;

-- C2 SERVICE: called by S2 offer_expiry job runner when the timer fires.
-- No p_actor — runs as the job runner; auth check happens at the runner layer.
-- REVOKE from authenticated/anon below; only service_role calls this.
create or replace function match_expire_offer(p_offer uuid)
returns int language plpgsql security definer set search_path=public as $fn$
begin
  return match_resolve_offer_negative(p_offer, 'expired');
end $fn$;

-- C2/C11.4 PUBLIC: user voluntarily withdraws from one instance's queue/offer.
create or replace function match_withdraw(p_actor uuid, p_instance uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare oid uuid; cre uuid;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  -- If actor holds the active offer, resolve it negative (closes chat, sets offer_passed)
  select id into oid from offers
    where date_instance_id=p_instance and candidate_id=p_actor and status='active';
  if oid is not null then
    perform match_resolve_offer_negative(oid, 'passed');
  else
    update queue_entries set status='offer_passed', updated_at=now()
      where date_instance_id=p_instance and candidate_id=p_actor
        and status in ('interested','shortlisted','standby');
  end if;
  -- Notify creator that someone withdrew (if there was an active offer; otherwise silent)
  if oid is not null then
    perform dispatch_notification(cre, 'offer_withdrawn',
              jsonb_build_object('instance', p_instance, 'offer_id', oid, 'candidate', p_actor));
  end if;
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_withdrawn', p_actor, 'queue_entry', p_actor,
          jsonb_build_object('instance', p_instance, 'offer_id', oid));
end $fn$;

-- Grants/REVOKEs per A.7 hardening pattern
revoke all on function match_auto_roll(uuid) from public, anon, authenticated;
revoke all on function match_resolve_offer_negative(uuid, offer_status) from public, anon, authenticated;
revoke all on function match_expire_offer(uuid) from public, anon, authenticated;

revoke all on function match_pass_offer(uuid, uuid) from public, anon;
revoke all on function match_withdraw(uuid, uuid) from public, anon;
