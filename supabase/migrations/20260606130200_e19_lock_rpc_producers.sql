-- 20260606130000_e19_lock_rpc_producers.sql
-- E19 / REQ-E19 / D-03 / D-04: the PRODUCER half — enqueue day_of_reconfirm +
-- safety_checkin from BOTH lock RPCs, atomically with the lock, beside the
-- existing rating_window enqueue. Consumers (dispatch_date_reconfirm /
-- dispatch_safety_checkin) + handlers shipped in 06-03.
--
-- ORDERING (CRITICAL): the LIVE bodies of match_accept_offer +
-- match_resolve_reciprocal were last re-CREATEd by
-- 20260606120100_e16_dispatch_identity_revealed.sql (which added
-- identity_revealed dispatches alongside new_match at both lock RPCs). This
-- migration is the e16 body VERBATIM + the two new safety enqueues. Its
-- timestamp (20260606130000) sorts STRICTLY AFTER 20260606120100 so on a
-- `supabase db reset` it applies AFTER e16 — e16 never clobbers these enqueues.
-- DO NOT drop the new_match OR identity_revealed dispatches; everything e16
-- added is preserved.
--
-- CREATE strategy (T-06-12): CREATE OR REPLACE, NO DROP — both are PUBLIC C2
-- RPCs that rely on an inherited `grant to authenticated` (the 127800 lineage
-- declares no explicit grant line for these two). DROP would strip it. The
-- only deltas vs. the e16 definitions are the two new enqueue_job calls per
-- lock RPC. Signatures, SECURITY DEFINER SET search_path, all existing logic,
-- the rating_window enqueue, new_match + identity_revealed dispatches — all
-- unchanged.
--
-- SOFT POSTURE (D-03/D-04): producers ONLY enqueue jobs. No enforcement, no
-- auto-cancel — the consumers (06-03) merely dispatch notifications.
--
-- Morning-of tz anchor (RESEARCH A5 / Pattern 3): the day_of_reconfirm
-- run_after resolves the DATE's city tz from the lock's date_instance
-- (date_instances.city_id -> cities.timezone — FK confirmed at
-- 20260525120300:32 / 20260525120000:11), NOT profiles.primary_city_id. The
-- anchor = 09:00 local on the morning the date starts:
--   date_trunc('day', lower(rng) at time zone v_tz) at time zone v_tz + interval '9 hours'.
-- Permissive degrade (matches dispatch_notification's tz posture): if the city
-- tz is unresolved, fall back to `lower(rng) - interval '6 hours'` (a UTC
-- morning-of approximation) so the job still fires.
--
-- safety_checkin run_after = upper(rng) + interval '2 hours' (post-date window,
-- mirrors the rating_window anchor). Dedup keys mirror rating:||lid ->
-- reconfirm:||lid and checkin:||lid.
--
-- GATED PROD-APPLY: local apply + advisor + the e19_producers.sql assertion are
-- DEFERRED to 06-05. Do NOT push to prod (ufufmcpnysvwtutpbian).

-- ============================================================================
-- 1. match_accept_offer — e16 body verbatim + day_of_reconfirm + safety_checkin
--    enqueues beside the rating_window enqueue (instance = inst).
-- ============================================================================
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
  v_tz text;                 -- E19: the date city's tz for the morning-of anchor
  v_reconfirm_at timestamptz;
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

  -- 15b. E19 (REQ-E19 / D-04): day_of_reconfirm — the morning-of "still on?".
  --      Anchor = 09:00 on the date's start day, in the date city's local tz.
  --      Resolve the city tz from the lock's date_instance (NOT primary_city_id);
  --      degrade permissive to a UTC morning-of approximation if tz is unknown.
  select c.timezone into v_tz
    from date_instances di join cities c on c.id = di.city_id
    where di.id = inst;
  if v_tz is not null then
    v_reconfirm_at := date_trunc('day', lower(rng) at time zone v_tz) at time zone v_tz + interval '9 hours';
  else
    v_reconfirm_at := lower(rng) - interval '6 hours';   -- permissive degrade (UTC morning-of)
  end if;
  perform enqueue_job('day_of_reconfirm', v_reconfirm_at,
    jsonb_build_object('lock_id', lid), 'reconfirm:'||lid::text);

  -- 15c. E19 (REQ-E19 / D-03): safety_checkin — the post-date "all good?" ping.
  --      Anchor = end of the date window + 2h grace (mirrors rating_window).
  perform enqueue_job('safety_checkin', upper(rng) + interval '2 hours',
    jsonb_build_object('lock_id', lid), 'checkin:'||lid::text);

  -- 17. dispatch new_match notification to BOTH parties
  perform dispatch_notification(cand, 'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
  perform dispatch_notification(cre,  'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));

  -- 17b. E16 (REQ-E16 / D-02): the reveal threshold. dispatch identity_revealed to
  -- BOTH parties, deep-linked to /matches/[lockId]. Consent-gated (matches_enabled)
  -- inside dispatch_notification. cand/cre are the resolved lock participants only.
  perform dispatch_notification(cand, 'identity_revealed', jsonb_build_object('lock_id', lid, 'instance', inst));
  perform dispatch_notification(cre,  'identity_revealed', jsonb_build_object('lock_id', lid, 'instance', inst));

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

-- ============================================================================
-- 2. match_resolve_reciprocal — e16 body verbatim + day_of_reconfirm +
--    safety_checkin enqueues. NOTE: there is NO `inst` local here — the
--    instance is p_chosen_instance; use it for the tz join + run_after math.
-- ============================================================================
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
  v_tz text;                 -- E19: the date city's tz for the morning-of anchor
  v_reconfirm_at timestamptz;
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

  -- E19 (REQ-E19 / D-04): day_of_reconfirm on the reciprocal path. Same anchor as
  -- the accept path — 09:00 morning-of in the date city's tz, resolved from the
  -- chosen instance (no `inst` local here; the instance is p_chosen_instance).
  -- Permissive UTC degrade if tz unknown.
  select c.timezone into v_tz
    from date_instances di join cities c on c.id = di.city_id
    where di.id = p_chosen_instance;
  if v_tz is not null then
    v_reconfirm_at := date_trunc('day', lower(rng) at time zone v_tz) at time zone v_tz + interval '9 hours';
  else
    v_reconfirm_at := lower(rng) - interval '6 hours';   -- permissive degrade (UTC morning-of)
  end if;
  perform enqueue_job('day_of_reconfirm', v_reconfirm_at,
    jsonb_build_object('lock_id', lid), 'reconfirm:'||lid::text);

  -- E19 (REQ-E19 / D-03): safety_checkin on the reciprocal path — post-date window.
  perform enqueue_job('safety_checkin', upper(rng) + interval '2 hours',
    jsonb_build_object('lock_id', lid), 'checkin:'||lid::text);

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

  -- E16 (REQ-E16 / D-02): the reveal threshold on the reciprocal path. Same
  -- identity_revealed dispatch to BOTH parties, carrying 'via','reciprocal' to
  -- match the sibling new_match style. Consent-gated (matches_enabled) inside
  -- dispatch_notification. cand/cre are the resolved lock participants only.
  perform dispatch_notification(cand, 'identity_revealed',
            jsonb_build_object('lock_id', lid, 'instance', p_chosen_instance, 'via', 'reciprocal'));
  perform dispatch_notification(cre, 'identity_revealed',
            jsonb_build_object('lock_id', lid, 'instance', p_chosen_instance, 'via', 'reciprocal'));

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_reciprocal_resolved', p_actor, 'lock', lid,
          jsonb_build_object('pair_id', p_pair_id, 'instance', p_chosen_instance));

  perform match_idem_store(p_actor, 'resolve_reciprocal', p_idem_key,
    jsonb_build_object('lock_id', lid));
  return lid;
end $function$;
