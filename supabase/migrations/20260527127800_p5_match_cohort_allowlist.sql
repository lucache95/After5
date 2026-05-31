-- 20260527127800_p5_match_cohort_allowlist.sql
-- COHORT ALLOWLIST for the matching gate.
--
-- Goal: effective gate = global flag `match_v2_enabled` ON  OR  acting user is in
-- the `match_cohort` allowlist. This lets a specific cohort use the dating loop
-- while the GLOBAL flag stays OFF — no flag flip for everyone.
--
-- Safe no-op invariant: when the global flag is OFF and match_cohort is EMPTY,
-- app_match_enabled(p) = false for every p, so every gated function behaves
-- byte-for-byte identically to today.
--
-- The ONLY change to each redefined function below is swapping the inline gate
--   coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false)
-- for app_match_enabled(<actor>). Every other line of every function body is
-- reproduced verbatim from pg_get_functiondef.

-- ============================================================================
-- 1. match_cohort table — secure-by-default (deny-all RLS, same posture as jobs).
-- ============================================================================
create table if not exists match_cohort (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note text
);
alter table match_cohort enable row level security;
-- No policies: match_cohort is written/read only by the service-role / postgres
-- and by SECURITY DEFINER functions (which run as owner). Default-deny for
-- anon/authenticated, identical posture to the `jobs` internal table.

-- ============================================================================
-- 2. app_match_enabled(p_user) — central effective-gate helper.
--    STABLE SECURITY DEFINER so it can read feature_config + match_cohort from
--    inside other DEFINER functions regardless of caller privileges.
-- ============================================================================
create or replace function app_match_enabled(p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false)
      or (p_user is not null and exists (select 1 from match_cohort c where c.user_id = p_user));
$$;

-- Only called inside other DEFINER functions (which run as owner); never directly
-- by clients. Strip implicit default grants, same as match_* internal helpers
-- (see 20260527126650_p5_revoke_internals_from_anon.sql).
revoke all on function app_match_enabled(uuid) from public, anon, authenticated;

-- ============================================================================
-- 3. Redefine USER-INITIATED gating functions to call app_match_enabled(<actor>).
--    Actor passed to app_match_enabled per function:
--      match_shortlist          -> p_actor
--      match_make_offer         -> p_actor
--      match_accept_offer       -> p_actor
--      match_pass_offer         -> p_actor
--      match_withdraw           -> p_actor
--      match_resolve_reciprocal -> p_actor
--      match_cancel_lock        -> p_actor   (also user-initiated + carried the P5000 gate)
--      record_swipe (swipe hook)-> auth.uid() (the swiping user; no p_actor arg)
-- ============================================================================

-- 3a. match_shortlist -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cre uuid; offer_holder uuid;
begin
  -- C10 auth check
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- feature flag gate (P5000) — cohort-aware
  if not app_match_enabled(p_actor) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  if p_rank < 1 then raise exception 'bad_rank' using errcode='22023'; end if;

  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;

  -- serialize against make_offer/auto_roll on this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  -- frozen-slot rule: cannot move the active offer-holder off rank 1, nor assign rank 1 to anyone else.
  select candidate_id into offer_holder
    from queue_entries where date_instance_id=p_instance and status='offer_active';
  if offer_holder is not null then
    if (p_candidate = offer_holder and p_rank <> 1)
       or (p_candidate <> offer_holder and p_rank = 1)
    then raise exception 'rank_frozen' using errcode='P0001'; end if;
  end if;

  update queue_entries
     set status = case when status='interested' then 'shortlisted'::queue_status else status end,
         rank = p_rank,
         swiper_disclosed_at = coalesce(swiper_disclosed_at, now()),
         updated_at = now()
   where date_instance_id=p_instance and candidate_id=p_candidate
     and status in ('interested','shortlisted','standby');
  if not found then raise exception 'not_interested' using errcode='P0002'; end if;

  -- audit + analytics (C8/C11.8)
  insert into audit_log(entity, entity_id, action, new_status, actor)
  values ('swiper_disclosure', p_candidate, 'disclosed_to_creator', 'shortlisted', p_actor);

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_shortlisted', p_actor, 'queue_entry', p_candidate,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate, 'rank', p_rank));
end $function$;

-- 3b. match_make_offer ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cre uuid;
  st  date_match_status;
  oid uuid;
  exp timestamptz;
  prior jsonb;
  reciprocal_offer uuid;
  both_dating_enabled boolean;
  lo uuid;
  hi uuid;
  v_pair_id uuid;
begin
  -- 1. C10 auth
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- 2. feature flag (P5000) — cohort-aware
  if not app_match_enabled(p_actor) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  -- 3. idempotency replay (offer path only; reciprocal upsert is naturally idempotent)
  prior := match_idem_lookup(p_actor, 'make_offer', p_idem_key);
  if prior is not null then return jsonb_build_object('kind','offer','offer_id', (prior->>'offer_id')::uuid); end if;

  -- 4. serialize all offer/lock/roll activity for this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  -- 5. dating_enabled both parties (P5002 per spec §2.5)
  select bool_and(dating_enabled) into both_dating_enabled
    from profiles where id in (p_actor, p_candidate);
  if not coalesce(both_dating_enabled, false) then
    raise exception 'account_gated' using errcode='P5002', detail='dating_disabled';
  end if;

  -- 6. blocks check both directions (P5002)
  if exists (select 1 from blocks b
    where (b.blocker_id=p_actor and b.blocked_id=p_candidate)
       or (b.blocker_id=p_candidate and b.blocked_id=p_actor)) then
    raise exception 'account_gated' using errcode='P5002', detail='blocked';
  end if;

  -- 7. instance + creator + status
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
  if st <> 'seeking' then raise exception 'instance_not_seeking' using errcode='P0001'; end if;

  -- 8. single-active-offer guard (advisory lock makes this race-free; index is backstop → P5003)
  if exists (select 1 from offers where date_instance_id=p_instance and status='active') then
    raise exception 'offer_already_active' using errcode='P5003';
  end if;

  -- 9. candidate must be shortlisted
  if not exists (select 1 from queue_entries
                  where date_instance_id=p_instance and candidate_id=p_candidate and status='shortlisted') then
    raise exception 'not_shortlisted' using errcode='P0002';
  end if;

  -- 10. can_enter_lock_flow gate (P5002)
  if not can_enter_lock_flow(p_candidate) then
    raise exception 'account_gated' using errcode='P5002', detail='candidate_not_eligible';
  end if;

  -- 11. reciprocal detection — spec §2.8. [option (b): COMMIT pair row + RETURN, no RAISE]
  -- A reciprocal pair: candidate has an active offer TO us (creator/actor) on a DIFFERENT instance.
  -- Returning (not raising) lets the pair insert + notifications commit. We return at exactly
  -- the point the old code raised — before the offer insert — so no offer is created here.
  select id into reciprocal_offer from offers
    where creator_id = p_candidate
      and candidate_id = p_actor
      and date_instance_id <> p_instance
      and status = 'active'
    limit 1;
  if reciprocal_offer is not null then
    -- Ordered users must match reciprocal_pairs UNIQUE(low_user, high_user) and how
    -- match_resolve_reciprocal reads lo/hi.
    lo := least(p_actor, p_candidate);
    hi := greatest(p_actor, p_candidate);
    -- Upsert the pair row so match_resolve_reciprocal has a pair to resolve (idempotent).
    insert into reciprocal_pairs(low_user, high_user, status)
    values (lo, hi, 'open')
    on conflict (low_user, high_user) do update set status='open', resolved_at=null
    returning id into v_pair_id;
    -- Emit reciprocal_detected notifications to BOTH creators so the chooser UI can be opened.
    perform dispatch_notification(p_actor, 'reciprocal_detected',
              jsonb_build_object('pair_id', v_pair_id, 'pair_offer_id', reciprocal_offer, 'my_pending_instance', p_instance));
    perform dispatch_notification(p_candidate, 'reciprocal_detected',
              jsonb_build_object('pair_id', v_pair_id, 'pair_offer_id', reciprocal_offer, 'my_pending_instance', p_instance));
    -- Reciprocal is a normal response, not an error: return so the pair commits.
    return jsonb_build_object('kind','reciprocal','pair_id', v_pair_id);
  end if;

  -- 12. insert offer with expires_at from C11.1 feature_config
  exp := offer_expires_at();
  insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
  values (p_instance, p_candidate, cre, 'active', exp)
  returning id into oid;

  -- 13. promote candidate to offer_active, freeze rank-1 snapshot
  update queue_entries
     set status='offer_active', rank=1, offer_frozen_rank=1, updated_at=now()
   where date_instance_id=p_instance and candidate_id=p_candidate;

  -- 14. open chat thread (Z)
  perform open_chat_thread(oid);

  -- 15. enqueue offer_expiry timer (dedup on offer id so retries don't double-enqueue)
  perform enqueue_job('offer_expiry', exp, jsonb_build_object('offer_id', oid), oid::text);

  -- 16. notify candidate (offer_received)
  perform dispatch_notification(p_candidate, 'offer_received',
            jsonb_build_object('instance', p_instance, 'offer_id', oid, 'expires_at', exp));

  -- 17. analytics
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_offer_made', p_actor, 'offer', oid,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate, 'expires_at', exp));

  -- 18. record idempotency, return discriminated offer result
  perform match_idem_store(p_actor, 'make_offer', p_idem_key, jsonb_build_object('offer_id', oid));
  return jsonb_build_object('kind','offer','offer_id', oid);
end $function$;

-- 3c. match_accept_offer ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_accept_offer(p_actor uuid, p_offer uuid, p_idem_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prior jsonb;
  inst uuid;
  cre uuid;
  cand uuid;
  ostatus offer_status;
  oexpires_at timestamptz;
  rng tstzrange;
  lid uuid;
  is_seed bool;
  thread_id uuid;
  lock_end timestamptz;
begin
  -- 1. C10 auth
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- 2. feature flag — cohort-aware
  if not app_match_enabled(p_actor) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  -- 3. idempotency replay
  prior := match_idem_lookup(p_actor, 'accept_offer', p_idem_key);
  if prior is not null then return (prior->>'lock_id')::uuid; end if;

  -- 4. load offer + verify p_actor is the candidate
  select date_instance_id, creator_id, candidate_id, status, expires_at
    into inst, cre, cand, ostatus, oexpires_at
    from offers where id=p_offer;
  if inst is null then raise exception 'no_offer' using errcode='P0002'; end if;
  if cand <> p_actor then raise exception 'not_offer_holder' using errcode='42501'; end if;

  -- 5. expiry check (P5007) — fail-fast before grabbing the advisory lock
  if oexpires_at < now() then
    raise exception 'offer_expired' using errcode='P5007';
  end if;

  -- 6. P5002 lock-flow gate for the acceptor (own standing/cooldown ladder)
  if not can_enter_lock_flow(p_actor) then
    raise exception 'account_gated' using errcode='P5002', detail='actor_not_eligible';
  end if;

  -- 7. P5005 chat_lock_ready (Z says yes at 5b launch; Phase 7 makes meaningful)
  thread_id := (select id from chat_threads where offer_id=p_offer);
  if thread_id is null or not chat_lock_ready(thread_id) then
    raise exception 'chat_not_ready' using errcode='P5005';
  end if;

  -- 8. serialize on the instance
  perform pg_advisory_xact_lock(match_instance_lock_key(inst));

  -- 9. re-read under lock; status may have changed (expired/passed) between fetch and lock
  select status into ostatus from offers where id=p_offer for update;
  if ostatus <> 'active' then
    raise exception 'offer_expired' using errcode='P5007';
  end if;

  select di.time_range, di.is_seed into rng, is_seed from date_instances di where di.id=inst for update;

  -- 10. insert the lock. S1 trigger sync_lock_participants writes lock_participants;
  --     GiST exclusion (lock_participants_no_overlap) enforces no double-book.
  begin
    insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lid;
  exception
    when exclusion_violation then raise exception 'time_conflict' using errcode='P5004';
    when unique_violation then raise exception 'time_conflict' using errcode='P5004', detail='already_locked';
  end;

  -- 11. resolve offer + queue + instance
  update offers set status='accepted', resolved_at=now() where id=p_offer;
  update queue_entries set status='locked', updated_at=now()
    where date_instance_id=inst and candidate_id=cand;
  update date_instances set status='matched', updated_at=now() where id=inst;

  -- 12. promote the chat thread (Z)
  perform promote_chat_thread_to_lock(p_offer, lid);

  -- 13. cancel pending expiry timer (worker no-ops even if it already fired)
  perform cancel_jobs('offer_expiry', p_offer::text);

  -- 14. enqueue cascade jobs (B's consumers handle the actual work async)
  --     14a. creator's OTHER instances that overlap → close them
  perform enqueue_job('standby_roll', now(),
    jsonb_build_object('kind','autoclose_creator_conflicts','creator',cre,'keep_instance',inst,'time_range',rng),
    'autoclose:'||cre::text||':'||lid::text);
  --     14b. candidate's OTHER queues that overlap → auto-withdraw
  perform enqueue_job('standby_roll', now(),
    jsonb_build_object('kind','autowithdraw_user_conflicts','user',cand,'keep_instance',inst,'time_range',rng),
    'autowithdraw:'||cand::text||':'||lid::text);

  -- 15. enqueue rating_window job (run_after = lock end + grace; default 2h grace from C11.1)
  lock_end := upper(rng) + interval '2 hours';
  perform enqueue_job('rating_window', lock_end,
    jsonb_build_object('lock_id', lid, 'instance', inst), 'rating:'||lid::text);

  -- 17. dispatch new_match notification to BOTH parties
  perform dispatch_notification(cand, 'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
  perform dispatch_notification(cre,  'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));

  -- analytics
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_lock_created', p_actor, 'lock', lid,
          jsonb_build_object('instance', inst, 'is_seed', is_seed));
  if is_seed then
    insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
    values ('match_seed_night_locked', p_actor, 'lock', lid,
            jsonb_build_object('instance', inst));
  end if;

  -- 18. record idempotency + return
  perform match_idem_store(p_actor, 'accept_offer', p_idem_key,
    jsonb_build_object('lock_id', lid, 'instance', inst, 'status','locked'));
  return lid;
end $function$;

-- 3d. match_pass_offer ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_pass_offer(p_actor uuid, p_offer uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cand uuid;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not app_match_enabled(p_actor) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;
  select candidate_id into cand from offers where id=p_offer;
  if cand is null then raise exception 'no_offer' using errcode='P0002'; end if;
  if cand <> p_actor then raise exception 'not_offer_holder' using errcode='42501'; end if;
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_offer_passed', p_actor, 'offer', p_offer, jsonb_build_object());
  return match_resolve_offer_negative(p_offer, 'passed');
end $function$;

-- 3e. match_withdraw --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_withdraw(p_actor uuid, p_instance uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare oid uuid; cre uuid;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not app_match_enabled(p_actor) then
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
end $function$;

-- 3f. match_resolve_reciprocal ---------------------------------------------
CREATE OR REPLACE FUNCTION public.match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_chosen_instance uuid, p_idem_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  lo uuid; hi uuid; pstatus text; prior jsonb;
  cre uuid; cand uuid; oid uuid; lid uuid;
  exp timestamptz; thread_id uuid; rng tstzrange;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not app_match_enabled(p_actor) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  prior := match_idem_lookup(p_actor, 'resolve_reciprocal', p_idem_key);
  if prior is not null then return (prior->>'lock_id')::uuid; end if;

  select low_user, high_user, status into lo, hi, pstatus
    from reciprocal_pairs where id=p_pair_id;
  if lo is null then raise exception 'no_pair' using errcode='P0002'; end if;
  if p_actor not in (lo,hi) then raise exception 'not_pair_party' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(match_pair_lock_key(lo,hi));
  select status into pstatus from reciprocal_pairs where id=p_pair_id for update;
  if pstatus='resolved' then
    raise exception 'reciprocal_stale' using errcode='P5009';
  end if;

  -- Validate the chosen instance is owned by one of the pair
  select creator_id into cre from date_instances where id=p_chosen_instance;
  if cre is null or cre not in (lo,hi) then
    raise exception 'chosen_not_owned_by_pair' using errcode='42501';
  end if;
  cand := case when cre=lo then hi else lo end;

  -- Find or create the active offer to the candidate on the chosen instance
  select id into oid from offers
    where date_instance_id=p_chosen_instance and candidate_id=cand and status='active';
  if oid is null then
    -- Ensure candidate is shortlisted on this instance
    update queue_entries set status='shortlisted', updated_at=now()
      where date_instance_id=p_chosen_instance and candidate_id=cand
        and status in ('interested','standby');
    if not exists (
      select 1 from queue_entries
       where date_instance_id=p_chosen_instance and candidate_id=cand
    ) then
      insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
      values (p_chosen_instance, cand, cre, 'shortlisted');
    end if;
    -- Inline offer creation (skip auth check; we're authoritative inside resolve_reciprocal)
    exp := offer_expires_at();
    insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
    values (p_chosen_instance, cand, cre, 'active', exp)
    returning id into oid;
    update queue_entries set status='offer_active', rank=1, offer_frozen_rank=1, updated_at=now()
      where date_instance_id=p_chosen_instance and candidate_id=cand;
    perform open_chat_thread(oid);
    perform enqueue_job('offer_expiry', exp, jsonb_build_object('offer_id', oid), oid::text);
  end if;

  -- Inline accept (skip auth + chat_lock_ready since this is server-authoritative)
  thread_id := (select id from chat_threads where offer_id=oid);
  if thread_id is null then perform open_chat_thread(oid); end if;

  select time_range into rng from date_instances where id=p_chosen_instance for update;

  begin
    insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (p_chosen_instance, cre, cand, 'active') returning id into lid;
  exception
    when exclusion_violation then
      raise exception 'reciprocal_double_booked' using errcode='P5004';
    when unique_violation then
      raise exception 'reciprocal_double_booked' using errcode='P5004', detail='already_locked';
  end;

  update offers set status='accepted', resolved_at=now() where id=oid;
  update queue_entries set status='locked', updated_at=now()
    where date_instance_id=p_chosen_instance and candidate_id=cand;
  update date_instances set status='matched', updated_at=now() where id=p_chosen_instance;
  perform promote_chat_thread_to_lock(oid, lid);
  perform cancel_jobs('offer_expiry', oid::text);
  perform enqueue_job('rating_window', upper(rng) + interval '2 hours',
    jsonb_build_object('lock_id', lid, 'instance', p_chosen_instance), 'rating:'||lid::text);

  -- Close the OTHER side: expire any active offers between this pair on different instances
  update offers set status='expired', resolved_at=now()
    where status='active'
      and ((creator_id=lo and candidate_id=hi) or (creator_id=hi and candidate_id=lo))
      and date_instance_id<>p_chosen_instance;

  -- Mark pair resolved
  update reciprocal_pairs set status='resolved', resolved_at=now() where id=p_pair_id;

  -- Notify both parties
  perform dispatch_notification(cand, 'new_match',
            jsonb_build_object('instance', p_chosen_instance, 'lock_id', lid, 'via', 'reciprocal'));
  perform dispatch_notification(cre, 'new_match',
            jsonb_build_object('instance', p_chosen_instance, 'lock_id', lid, 'via', 'reciprocal'));

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_reciprocal_resolved', p_actor, 'lock', lid,
          jsonb_build_object('pair_id', p_pair_id, 'instance', p_chosen_instance));

  perform match_idem_store(p_actor, 'resolve_reciprocal', p_idem_key,
    jsonb_build_object('lock_id', lid));
  return lid;
end $function$;

-- 3g. match_cancel_lock -----------------------------------------------------
-- NOTE: not named in the brief's explicit list, but it is a USER-INITIATED RPC
-- (auth.uid()=p_actor) that carried the same inline P5000 gate and is part of
-- the cohort's end-to-end loop (cancel a lock). Gated on p_actor for parity.
CREATE OR REPLACE FUNCTION public.match_cancel_lock(p_actor uuid, p_lock uuid, p_reason text, p_idem_key uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prior jsonb;
  inst uuid; cre uuid; matched uuid; lstatus lock_status;
  other uuid;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not app_match_enabled(p_actor) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;
  if p_reason not in ('mutual','no_show','creator_pre_lock','safety') then
    raise exception 'bad_reason' using errcode='22023', detail=p_reason;
  end if;

  prior := match_idem_lookup(p_actor, 'cancel_lock', p_idem_key);
  if prior is not null then return; end if;

  -- Load lock
  select date_instance_id, creator_id, matched_user_id, status
    into inst, cre, matched, lstatus
    from locks where id=p_lock for update;
  if inst is null then raise exception 'no_lock' using errcode='P0002'; end if;
  if lstatus <> 'active' then return; end if;  -- idempotent on already-cancelled/completed
  if p_actor not in (cre, matched) then
    raise exception 'not_lock_party' using errcode='42501';
  end if;
  other := case when p_actor=cre then matched else cre end;

  perform pg_advisory_xact_lock(match_instance_lock_key(inst));

  -- Mark lock cancelled
  update locks
     set status='cancelled', cancelled_by=p_actor, cancel_reason=p_reason::cancel_reason,
         updated_at=now()
   where id=p_lock;

  -- Safety branch: update standing + admin_alerts + bulk_withdraw — ALL in this txn
  if p_reason = 'safety' then
    -- Lower the OTHER party's standing if actor reported safety concern
    update profiles set standing='warned' where id=other;
    -- Admin alert
    insert into admin_alerts(kind, payload)
    values ('safety_lock_cancel',
            jsonb_build_object('severity', 'high', 'lock_id', p_lock, 'reporter', p_actor,
                               'subject', other, 'instance', inst));
    -- Bulk-withdraw the subject from their other matching surfaces (async via job)
    perform enqueue_job('bulk_withdraw', now(),
      jsonb_build_object('user', other, 'reason', 'safety_after_lock_cancel',
                         'triggered_by_lock', p_lock), null);
    -- Notify subject (the cancelled-against party)
    perform dispatch_notification(other, 'lock_cancelled_frozen',
              jsonb_build_object('lock_id', p_lock, 'instance', inst));
    -- Notify reporter (the canceller)
    perform dispatch_notification(p_actor, 'lock_cancelled_frozen',
              jsonb_build_object('lock_id', p_lock, 'instance', inst,
                                 'reason', 'safety'));
  else
    -- Non-safety cancel: standard notification, re-open the instance for auto-roll
    perform dispatch_notification(other, 'lock_cancelled_rolled',
              jsonb_build_object('lock_id', p_lock, 'instance', inst, 'reason', p_reason));
    perform dispatch_notification(p_actor, 'lock_cancelled_rolled',
              jsonb_build_object('lock_id', p_lock, 'instance', inst, 'reason', p_reason));
    -- Roll back instance + offer state so auto_roll can promote next standby
    update date_instances set status='seeking', updated_at=now() where id=inst;
    update offers set status='passed', resolved_at=coalesce(resolved_at, now())
      where date_instance_id=inst and status='accepted';
    update queue_entries set status='offer_passed', updated_at=now()
      where date_instance_id=inst and candidate_id=matched and status='locked';
    -- Cancel any rating_window job that was enqueued
    perform cancel_jobs('rating_window', 'rating:'||p_lock::text);
    -- Auto-roll to find next match
    perform match_auto_roll(inst);
  end if;

  -- Analytics
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_lock_cancelled', p_actor, 'lock', p_lock,
          jsonb_build_object('reason', p_reason, 'instance', inst, 'other_party', other));

  perform match_idem_store(p_actor, 'cancel_lock', p_idem_key,
    jsonb_build_object('lock_id', p_lock, 'reason', p_reason));
end $function$;

-- 3h. record_swipe (S5 swipe hook from 20260527126700) ----------------------
-- Actor here is the SWIPING user = auth.uid() (the function has no p_actor arg).
-- ONLY the hook's gate predicate changes; the legacy insert path is untouched.
create or replace function record_swipe(p_instance uuid, p_direction swipe_direction)
returns void language plpgsql security definer set search_path=public as $function$
declare v_actor uuid := auth.uid(); v_creator uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select creator_id into v_creator from date_instances where id = p_instance;
  if v_creator is null then raise exception 'no such date instance' using errcode='P0002'; end if;
  if v_creator = v_actor then raise exception 'cannot swipe your own night' using errcode='P0001'; end if;

  insert into swipes (swiper_id, date_instance_id, creator_id, direction)
  values (v_actor, p_instance, v_creator, p_direction)
  on conflict (swiper_id, date_instance_id) do nothing;

  -- A.8 hook: on right-swipe, populate queue_entries via match_ingest_interest.
  -- Called only when match is enabled for the swiping user (global flag OR cohort);
  -- otherwise S5 stays in legacy mode.
  -- The ingest is idempotent (ON CONFLICT DO NOTHING) so repeat right-swipes don't dup rows.
  if p_direction = 'right'::swipe_direction
     and app_match_enabled(v_actor)
  then
    perform match_ingest_interest(p_instance);
  end if;
end $function$;

-- ============================================================================
-- 4. SCOPE DECISION — SYSTEM / JOB paths.
--
-- Verified: the ONLY functions that carried the inline `match_v2_enabled` gate
-- today are the user-initiated RPCs above + record_swipe. The system/job paths
--   match_bulk_withdraw, match_auto_roll, match_resolve_offer_negative,
--   match_ingest_interest, b_complete reapers, expire/auto-roll handlers,
--   and the 127100 reciprocal wire
-- NEVER carried the flag gate — they run unconditionally regardless of the
-- global flag (they are server-authoritative cleanup/cascade invoked by the
-- job runner or from inside the gated RPCs). There is therefore NO gate
-- predicate to "swap" in these functions.
--
-- Decision: LEAVE THEM ON THEIR CURRENT (UNGATED) BEHAVIOR. Per-function:
--   - match_bulk_withdraw(p_actor):  no flag gate today (only `p_actor is null`
--       short-circuit). It is system cleanup driven by the bulk_withdraw job and
--       by match_cancel_lock's safety branch. Leaving it ungated keeps cohort
--       safety-cancel flows working when the global flag is OFF. NO CHANGE.
--   - match_auto_roll / match_resolve_offer_negative / match_ingest_interest:
--       internal cascade helpers, ungated today, invoked only from already-gated
--       RPCs or the job runner. Gating them would BREAK the cohort loop (offer
--       expiry roll, pass resolution, swipe ingest) when global is OFF. NO CHANGE.
--   - expire / auto-roll job handlers + b_complete reapers + 127100 wire:
--       pure system timers/reapers with no user actor; ungated today. They must
--       keep firing so a cohort's offers expire and locks complete. NO CHANGE.
--
-- Net effect: the cohort's end-to-end loop (shortlist→offer→accept→lock→reveal
-- →rate) works with global flag OFF, because the user-entry RPCs are now
-- cohort-aware and the supporting system jobs were never flag-gated.
-- ============================================================================
