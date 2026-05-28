-- 20260527126400_p5_accept_lock.sql
-- A.5: match_accept_offer (public C2 RPC).
-- Pipeline:
--   1. C10 auth (P5001)
--   2. feature flag (P5000)
--   3. idempotency replay
--   4. load offer (NO_OFFER), verify candidate is the offer holder
--   5. P5007 offer_expired check (expires_at < now)
--   6. P5002 can_enter_lock_flow(actor)
--   7. P5005 chat_lock_ready (Z says yes at 5b launch)
--   8. advisory-lock instance
--   9. re-read offer status under lock; must be 'active'
--  10. insert lock (GiST exclusion → P5004 time_conflict)
--  11. resolve offer + queue + date_instance status
--  12. Z.promote_chat_thread_to_lock
--  13. cancel offer_expiry job (dedup_key = offer.id)
--  14. enqueue standby_roll job for actor's other conflicting instances (B consumer)
--  15. enqueue standby_roll job for candidate's other conflicting offers (B consumer)
--  16. enqueue rating_window job (run_after = lock end + grace)
--  17. dispatch new_match notification to both parties
--  18. record idempotency + return lock uuid
--
-- The cascade work (closing the creator's other instances, withdrawing the
-- candidate from their other queues) happens in async jobs (B's consumers),
-- NOT inline. A.5 enqueues, B's match_auto_roll + match_autoclose_creator_conflicts
-- consume from the jobs table.

create or replace function match_accept_offer(
  p_actor uuid,
  p_offer uuid,
  p_idem_key uuid
)
returns uuid language plpgsql security definer set search_path=public as $fn$
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

  -- 2. feature flag
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
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
end $fn$;
-- match_accept_offer is a PUBLIC C2 RPC; do NOT revoke from authenticated.
