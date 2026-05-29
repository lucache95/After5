-- 20260527127100_p5_reciprocal_pair_wire.sql
-- 5b reciprocal fix — Option (b): make_offer returns a discriminated jsonb and
-- COMMITS the reciprocal_pairs row instead of raising P5008.
--
-- Background: match_make_offer (20260527126300) detected a reciprocal and raised
-- P5008. A prior fix attempt (option a) tried to INSERT the reciprocal_pairs row
-- and then RAISE P5008 carrying pair_id — but a RAISE rolls the whole statement
-- back, so the pair row never persisted and match_resolve_reciprocal (which reads
-- reciprocal_pairs WHERE id=p_pair_id) had nothing to resolve. The flow was dead.
--
-- Option (b) — the approved approach — treats reciprocal as a NORMAL RESPONSE,
-- not an error:
--   * CONTRACT CHANGE: match_make_offer now RETURNS jsonb (was uuid). Because the
--     return type changes, this migration DROPs then CREATEs the function and
--     re-applies the exact grant from 20260527126650 (revoke all from public,anon;
--     authenticated stays — it is a public C2 RPC gated by the auth.uid() check).
--   * Happy path returns jsonb_build_object('kind','offer','offer_id', <oid>).
--   * Reciprocal detection upserts the reciprocal_pairs row (status='open'),
--     emits BOTH reciprocal_detected notifications (now carrying pair_id), and
--     RETURNS jsonb_build_object('kind','reciprocal','pair_id', <id>). No RAISE,
--     so the pair insert + notifications COMMIT and match_resolve_reciprocal finally
--     has a pair to resolve. No offer is created on this branch (it returns at the
--     same point the old code raised, before the offer insert).
--   * All OTHER error paths (P5000/P5001/P5002/P5003/P0001/P0002/42501) stay as
--     genuine RAISE ... using errcode — they are real failures, not control flow.
--   * CALLERS MUST BRANCH on result->>'kind' ('offer' | 'reciprocal') and read
--     offer_id / pair_id accordingly.
-- All 18 pipeline steps are otherwise preserved byte-for-byte. Supersedes the
-- reciprocal block + return type in 20260527126300. Resolves audit findings 4-a
-- (scalar return) and 2-c/4-b (P5008 keying).

-- Return type changes (uuid -> jsonb), so we must drop+recreate.
drop function if exists match_make_offer(uuid, uuid, uuid, uuid);

create function match_make_offer(
  p_actor uuid,
  p_instance uuid,
  p_candidate uuid,
  p_idem_key uuid
)
returns jsonb language plpgsql security definer set search_path=public as $fn$
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

  -- 2. feature flag (P5000)
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
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
end $fn$;

-- Re-apply the grant from 20260527126650 (drop+recreate resets privileges to defaults):
-- match_make_offer is a PUBLIC C2 RPC; revoke anon, keep authenticated (auth enforced
-- via the auth.uid()=p_actor check inside).
revoke all on function public.match_make_offer(uuid, uuid, uuid, uuid) from public, anon;
