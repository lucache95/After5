-- 20260527126900_p5_b_complete.sql
-- B-complete: finishes the deferred work from B-lite (20260527126800).
-- Ships: real match_auto_roll, cascade consumers (autoclose/autowithdraw),
-- match_cancel_lock with reason taxonomy + safety atomicity, reciprocal_pairs +
-- match_resolve_reciprocal, bulk_withdraw consumer.

-- ============================================================================
-- 0. Extend cancel_reason enum with B-complete reasons (mutual, no_show, creator_pre_lock)
--    'safety' is already in the enum.
-- ============================================================================
alter type cancel_reason add value if not exists 'mutual';
alter type cancel_reason add value if not exists 'no_show';
alter type cancel_reason add value if not exists 'creator_pre_lock';

-- ============================================================================
-- 1. reciprocal_pairs table (for match_make_offer's P5008 path resolution)
-- ============================================================================
create table if not exists reciprocal_pairs (
  id uuid primary key default gen_random_uuid(),
  low_user uuid not null,
  high_user uuid not null,
  status text not null default 'open' check (status in ('open','resolved','stale')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (low_user, high_user)
);
alter table reciprocal_pairs enable row level security;
-- Self-read: either party can see their own pair
drop policy if exists reciprocal_pairs_self_read on reciprocal_pairs;
create policy reciprocal_pairs_self_read on reciprocal_pairs for select to authenticated
  using (low_user = auth.uid() or high_user = auth.uid());

-- ============================================================================
-- 2. match_auto_roll (real): promotes next standby to a fresh offer
-- ============================================================================
-- Strategy: do the work inline (don't call match_make_offer because that
-- requires auth.uid()=creator). Replicates the relevant parts of make_offer's
-- body. Internal — only invoked from match_resolve_offer_negative (B-lite) and
-- from the S2 standby_roll job runner (service_role).
create or replace function match_auto_roll(p_instance uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare
  cre uuid; st date_match_status; cutoff timestamptz;
  nxt uuid; exp timestamptz; oid uuid;
begin
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  select creator_id, status, starts_at into cre, st, cutoff
    from date_instances where id=p_instance for update;
  if st <> 'seeking' then return null; end if;
  if exists (select 1 from offers where date_instance_id=p_instance and status='active') then
    return null;
  end if;
  -- Spec §7.6: freeze rollover within 2h cutoff of the night
  if cutoff < now() + interval '2 hours' then return null; end if;
  -- Spec §7.6: freeze entirely on non-dismissed report against this instance
  if exists (
    select 1 from reports
     where target_type='date_instance' and target_id=p_instance and status<>'dismissed'
  ) then return null; end if;

  -- Pick next standby: lowest-rank shortlisted first, then lowest-rank standby
  nxt := match_next_standby(p_instance);
  if nxt is null then
    select candidate_id into nxt from queue_entries
      where date_instance_id=p_instance and status='standby'
      order by rank nulls last, created_at limit 1;
  end if;
  if nxt is null then return null; end if;
  if not can_enter_lock_flow(nxt) then return null; end if;

  -- Promote to shortlisted (in case they were standby)
  update queue_entries set status='shortlisted', updated_at=now()
    where date_instance_id=p_instance and candidate_id=nxt;

  -- Inline make_offer body (no idem_key, no reciprocal check; auto-roll is server-driven)
  exp := offer_expires_at();
  insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
  values (p_instance, nxt, cre, 'active', exp)
  returning id into oid;

  update queue_entries set status='offer_active', rank=1, offer_frozen_rank=1, updated_at=now()
    where date_instance_id=p_instance and candidate_id=nxt;

  perform open_chat_thread(oid);
  perform enqueue_job('offer_expiry', exp, jsonb_build_object('offer_id', oid), oid::text);
  perform dispatch_notification(nxt, 'offer_received',
            jsonb_build_object('instance', p_instance, 'offer_id', oid, 'expires_at', exp));
  perform dispatch_notification(nxt, 'standby_promoted',
            jsonb_build_object('instance', p_instance, 'offer_id', oid));
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_auto_rolled', cre, 'offer', oid,
          jsonb_build_object('instance', p_instance, 'candidate', nxt));
  return oid;
end $fn$;

-- ============================================================================
-- 3. Cascade consumers: called from A.5's enqueued standby_roll jobs
-- ============================================================================
-- Creator's other scheduled instances overlapping the locked window auto-close.
create or replace function match_autoclose_creator_conflicts(p_creator uuid, p_keep_instance uuid, p_rng tstzrange)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int;
begin
  -- Close other seeking instances in this time window
  update date_instances
     set status='cancelled', updated_at=now()
   where creator_id=p_creator and id<>p_keep_instance
     and status='seeking' and time_range && p_rng;
  get diagnostics n = row_count;
  -- Expire active offers on those instances
  update offers set status='expired', resolved_at=now()
   where status='active' and date_instance_id in (
     select id from date_instances
       where creator_id=p_creator and status='cancelled' and time_range && p_rng
   );
  return n;
end $fn$;

-- Matched user auto-withdrawn from conflicting offers/standbys on OTHER instances.
-- Throttled per spec §7.3: per-window only, cap at 25, overflow → bulk_withdraw job.
create or replace function match_autowithdraw_user_conflicts(p_user uuid, p_rng tstzrange, p_keep_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare rec record; withdrawn int := 0; cap int := 25; dropped int;
begin
  for rec in
    select o.id as offer_id, o.date_instance_id as inst
      from offers o join date_instances di on di.id=o.date_instance_id
     where o.candidate_id=p_user and o.status='active'
       and o.date_instance_id<>p_keep_instance
       and di.time_range && p_rng
     order by o.created_at
  loop
    exit when withdrawn >= cap;
    update offers set status='expired', resolved_at=now() where id=rec.offer_id and status='active';
    update queue_entries set status='standby', updated_at=now()
      where date_instance_id=rec.inst and candidate_id=p_user;
    perform close_chat_thread(rec.offer_id);
    perform cancel_jobs('offer_expiry', rec.offer_id::text);
    -- Defer the roll on the freed-up instance via a fresh standby_roll job
    perform enqueue_job('standby_roll', now(),
      jsonb_build_object('kind','autoroll','instance', rec.inst),
      'standby_roll:'||rec.inst::text);
    withdrawn := withdrawn + 1;
  end loop;

  -- Drop user from overlapping standbys (no active offer to roll), bounded by cap
  with picked as (
    select q.ctid from queue_entries q join date_instances di on di.id=q.date_instance_id
     where q.candidate_id=p_user and q.status in ('shortlisted','standby')
       and di.time_range && p_rng and di.id<>p_keep_instance
     limit cap
  )
  update queue_entries q set status='offer_passed', updated_at=now()
    from picked where q.ctid=picked.ctid;
  get diagnostics dropped = row_count;

  if withdrawn >= cap or dropped >= cap then
    perform enqueue_job('bulk_withdraw', now(),
      jsonb_build_object('user',p_user,'range',p_rng::text,'keep',p_keep_instance), null);
  end if;
  return withdrawn;
end $fn$;

-- ============================================================================
-- 4. match_cancel_lock with reason taxonomy + safety atomicity
-- ============================================================================
-- Reasons: 'mutual', 'no_show', 'creator_pre_lock', 'safety'
-- Safety branch: atomically updates standing + admin_alerts + bulk_withdraw enqueue.
-- Non-safety: marks lock cancelled + dispatches lock_cancelled_rolled notifications + auto-rolls instance.
create or replace function match_cancel_lock(
  p_actor uuid,
  p_lock uuid,
  p_reason text,
  p_idem_key uuid
)
returns void language plpgsql security definer set search_path=public as $fn$
declare
  prior jsonb;
  inst uuid; cre uuid; matched uuid; lstatus lock_status;
  other uuid;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
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
end $fn$;

-- ============================================================================
-- 5. match_resolve_reciprocal: choose which instance becomes the lock when
--    both parties have offered each other simultaneously.
-- ============================================================================
create or replace function match_resolve_reciprocal(
  p_actor uuid,
  p_pair_id uuid,
  p_chosen_instance uuid,
  p_idem_key uuid
)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare
  lo uuid; hi uuid; pstatus text; prior jsonb;
  cre uuid; cand uuid; oid uuid; lid uuid;
  exp timestamptz; thread_id uuid; rng tstzrange;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
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
end $fn$;

-- ============================================================================
-- 6. Grants/REVOKEs
-- ============================================================================
revoke all on function match_auto_roll(uuid) from public, anon, authenticated;
revoke all on function match_autoclose_creator_conflicts(uuid, uuid, tstzrange) from public, anon, authenticated;
revoke all on function match_autowithdraw_user_conflicts(uuid, tstzrange, uuid) from public, anon, authenticated;

-- Public C2 RPCs (cancel_lock, resolve_reciprocal): authenticated-callable per A's pattern
revoke all on function match_cancel_lock(uuid, uuid, text, uuid) from public, anon;
revoke all on function match_resolve_reciprocal(uuid, uuid, uuid, uuid) from public, anon;
