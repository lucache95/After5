-- 20260527126300_p5_make_offer.sql
-- A.4: match_make_offer (public C2 RPC).
-- Pipeline (per spec §1 A + §2.5 invariants + §4.1 errcodes):
--   1. auth.uid()=p_actor (P5001)
--   2. feature flag match_v2_enabled (P5000)
--   3. idempotency replay
--   4. advisory-lock the instance
--   5. dating_enabled both parties (P5002)
--   6. blocks check both directions (P5002)
--   7. instance status='seeking', actor is creator
--   8. single-active-offer guard (offers_one_active_per_instance backstop → P5003)
--   9. candidate is shortlisted
--  10. can_enter_lock_flow(candidate) (P5002)
--  11. reciprocal detection (P5008) — raise BEFORE inserting offer; no partial state
--  12. insert offer with expires_at = offer_expires_at()
--  13. promote queue_entries → offer_active + freeze rank
--  14. open chat thread via Z
--  15. enqueue offer_expiry job (dedup_key = offer.id)
--  16. dispatch offer_received notification to candidate
--  17. record idempotency
--  18. return offer uuid
--
-- idem_key is uuid (overrides P5 source's text — see spec §2.9).

create or replace function match_make_offer(
  p_actor uuid,
  p_instance uuid,
  p_candidate uuid,
  p_idem_key uuid
)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare
  cre uuid;
  st  date_match_status;
  oid uuid;
  exp timestamptz;
  prior jsonb;
  reciprocal_offer uuid;
  both_dating_enabled boolean;
begin
  -- 1. C10 auth
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- 2. feature flag (P5000)
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  -- 3. idempotency replay
  prior := match_idem_lookup(p_actor, 'make_offer', p_idem_key);
  if prior is not null then return (prior->>'offer_id')::uuid; end if;

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

  -- 11. reciprocal detection (P5008) — spec §2.8.
  -- A reciprocal pair: candidate has an active offer TO us (creator/actor) on a DIFFERENT instance.
  -- Raise BEFORE inserting our offer; pair_id carried in detail for B's resolution flow.
  select id into reciprocal_offer from offers
    where creator_id = p_candidate
      and candidate_id = p_actor
      and date_instance_id <> p_instance
      and status = 'active'
    limit 1;
  if reciprocal_offer is not null then
    -- Emit reciprocal_detected notifications to BOTH creators so the chooser UI can be opened.
    perform dispatch_notification(p_actor, 'reciprocal_detected',
              jsonb_build_object('pair_offer_id', reciprocal_offer, 'my_pending_instance', p_instance));
    perform dispatch_notification(p_candidate, 'reciprocal_detected',
              jsonb_build_object('pair_offer_id', reciprocal_offer, 'my_pending_instance', p_instance));
    raise exception 'reciprocal_pending' using errcode='P5008', detail=reciprocal_offer::text;
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

  -- 18. record idempotency, return
  perform match_idem_store(p_actor, 'make_offer', p_idem_key, jsonb_build_object('offer_id', oid));
  return oid;
end $fn$;
-- match_make_offer is a PUBLIC C2 RPC; do NOT revoke from authenticated (auth enforced via auth.uid() check inside).
