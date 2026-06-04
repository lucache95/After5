-- 20260606120100_e16_dispatch_identity_revealed.sql
-- E16 / REQ-E16 / D-02: dispatch identity_revealed at the post-lock reveal threshold.
--
-- The threshold = the moment both sides lock. Both lock DEFINER RPCs already
-- dispatch new_match to both parties; this migration ADDS an identity_revealed
-- dispatch alongside it at BOTH sites (match_accept_offer AND
-- match_resolve_reciprocal — Pitfall 3: wiring only one site misses reciprocal
-- matches), deep-linked to /matches/[lockId].
--
-- identity_revealed respects matches_enabled consent (sibling of new_match,
-- resolved decision): a recipient with matches_enabled=false receives NO
-- identity_revealed notification. dispatch_notification's consent branch is
-- widened from p_type = 'new_match' to p_type in ('new_match','identity_revealed').
--
-- Spoofing mitigation (T-05-07): dispatch resolves ONLY the two lock participants
-- already bound inside each DEFINER body (cand/cre) — never an extra user. Payload
-- is server-constructed jsonb.
--
-- Tampering mitigation (T-05-08): all three re-CREATEs are CREATE OR REPLACE with
-- NO signature change, so existing grants survive. Each function keeps its existing
-- SET search_path. The only deltas vs. the prior definitions are the two new
-- identity_revealed dispatches per lock RPC and the one widened consent predicate.
-- No USING(true) is introduced. Run the Supabase security advisor after this DDL.
--
-- GATED PROD-APPLY: local-applied + advisor-clean here; prod apply is the gated
-- human checkpoint in 05-04. Do NOT push to prod (ufufmcpnysvwtutpbian).

-- ============================================================================
-- 1. match_accept_offer — re-CREATE verbatim + identity_revealed dispatch.
--    (original: 20260527127800_p5_match_cohort_allowlist.sql, line 252)
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
-- 2. match_resolve_reciprocal — re-CREATE verbatim + identity_revealed dispatch.
--    (original: 20260527127800_p5_match_cohort_allowlist.sql, line 438)
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

-- ============================================================================
-- 3. dispatch_notification — re-CREATE verbatim + widen the matches_enabled
--    consent branch to cover identity_revealed (sibling of new_match).
--    (original: 20260525123600_p2_dispatch_notification.sql)
--    Only delta vs. original: the consent predicate on line 52 becomes
--    `p_type in ('new_match','identity_revealed')`. Everything else verbatim;
--    keeps SET search_path = public, extensions + grants survive (no sig change).
-- ============================================================================
create or replace function dispatch_notification(
  p_user uuid, p_type notification_type, p_payload jsonb default '{}'
) returns json
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_is_safety boolean := p_type in ('safety_checkin','safety_alert');
  v_dedup text := nullif(p_payload->>'dedup_key','');
  v_prefs notification_preferences%rowtype;
  v_allowed boolean := true;
  v_rate json;
  v_notif_id uuid; v_existing uuid;
  v_tokens jsonb;
  v_channel notification_channel := 'suppressed';
  v_tz text; v_local time; v_qs time; v_qe time; v_in_quiet boolean := false;
begin
  -- dedup short-circuit
  if v_dedup is not null then
    select id into v_existing from notifications where type=p_type and dedup_key=v_dedup limit 1;
    if found then
      return json_build_object('notification_id', v_existing, 'channel', 'suppressed',
                               'tokens', '[]'::jsonb, 'reason', 'dedup');
    end if;
  end if;

  select * into v_prefs from notification_preferences where user_id = p_user;

  if not v_is_safety then
    -- 1) consent gate (missing prefs row => permissive defaults)
    if v_prefs.user_id is not null then
      if (not v_prefs.push_enabled and not v_prefs.email_enabled) then
        v_allowed := false;
      elsif p_type in ('offer_received','offer_expiring','standby_promoted') and not v_prefs.offers_enabled then
        v_allowed := false;
      -- C11.11 reconciliation: offer_withdrawn is offer-category
      elsif p_type = 'offer_withdrawn' and not v_prefs.offers_enabled then
        v_allowed := false;
      -- E16 (REQ-E16): identity_revealed is a match-category signal, sibling of
      -- new_match — it respects matches_enabled. A recipient who opted out of
      -- match notifications receives NO identity_revealed row.
      elsif p_type in ('new_match','identity_revealed') and not v_prefs.matches_enabled then
        v_allowed := false;
      elsif p_type = 'new_message' and not v_prefs.messages_enabled then
        v_allowed := false;
      elsif p_type in ('date_reconfirm','rating_request') and not v_prefs.reminders_enabled then
        v_allowed := false;
      elsif p_type in ('account','moderation_action') and not v_prefs.account_enabled then
        v_allowed := false;
      -- C11.11 reconciliation: verification types are account-category
      elsif p_type in ('verification_passed','verification_failed','appeal_resolved') and not v_prefs.account_enabled then
        v_allowed := false;
      end if;
    end if;
    -- 2) quiet-hours gate (user's city tz; degrade permissive if tz unknown)
    if v_allowed and v_prefs.quiet_hours_start is not null and v_prefs.quiet_hours_end is not null then
      select c.timezone into v_tz from profiles pr
        join cities c on c.id = pr.primary_city_id where pr.id = p_user;
      if v_tz is not null then
        v_local := (now() at time zone v_tz)::time;
        v_qs := v_prefs.quiet_hours_start; v_qe := v_prefs.quiet_hours_end;
        v_in_quiet := case when v_qs <= v_qe then (v_local >= v_qs and v_local < v_qe)
                           else (v_local >= v_qs or v_local < v_qe) end; -- wraps midnight
        if v_in_quiet then v_allowed := false; end if;
      end if;
    end if;
    -- 3) rate-limit gate
    if v_allowed then
      v_rate := notification_rate_check(p_user, p_type);
      if not (v_rate->>'allowed')::boolean then v_allowed := false; end if;
    end if;
  end if;

  -- channel pick: native push → web push → email. Safety always proceeds.
  if v_allowed or v_is_safety then
    select coalesce(jsonb_agg(jsonb_build_object(
             'platform', platform, 'expo_push_token', expo_push_token, 'web_push_sub', web_push_sub)), '[]'::jsonb)
      into v_tokens from devices
     where user_id = p_user and (expo_push_token is not null or web_push_sub is not null);

    if v_tokens @> '[{"platform":"ios"}]' then v_channel := 'push_ios';
    elsif v_tokens @> '[{"platform":"android"}]' then v_channel := 'push_android';
    elsif v_tokens @> '[{"platform":"web"}]' then v_channel := 'web_push';
    elsif coalesce(v_prefs.email_enabled, true) then v_channel := 'email';
    elsif v_is_safety then v_channel := 'admin_alert';  -- safety w/ no channel: fail loud
    else v_channel := 'suppressed';
    end if;
    -- The chain above already guarantees the safety fail-loud: a safety notification with
    -- no push device AND email disabled routes to 'admin_alert'; with email enabled, email
    -- is the guaranteed safety fallback. Safety never lands on 'suppressed'. No extra guard.
  end if;

  -- Insert is race-safe against the notifications_dedup_uniq partial index: a concurrent
  -- dispatch that wins the (type, dedup_key) race makes this ON CONFLICT a no-op (returns
  -- the existing row below) instead of raising 23505 to the caller.
  insert into notifications (user_id, type, payload, dedup_key, channel)
  values (p_user, p_type, coalesce(p_payload,'{}'), v_dedup, v_channel)
  on conflict (type, dedup_key) where dedup_key is not null do nothing
  returning id into v_notif_id;
  if v_notif_id is null and v_dedup is not null then
    select id into v_notif_id from notifications where type=p_type and dedup_key=v_dedup limit 1;
    return json_build_object('notification_id', v_notif_id, 'channel', 'suppressed',
                             'tokens', '[]'::jsonb, 'reason', 'dedup_race');
  end if;

  -- fail-loud terminus: a safety notification that resolved to admin_alert raises one now.
  if v_is_safety and v_channel = 'admin_alert' then
    perform raise_admin_alert('safety_no_device',
      json_build_object('user_id', p_user, 'type', p_type::text, 'notification_id', v_notif_id)::jsonb);
  end if;

  return json_build_object(
    'notification_id', v_notif_id,
    'channel', v_channel,
    'tokens', case when v_channel in ('push_ios','push_android','web_push') then v_tokens else '[]'::jsonb end
  );
end $fn$;
