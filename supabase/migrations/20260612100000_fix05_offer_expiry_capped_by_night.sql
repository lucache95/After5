-- 20260612100000_fix05_offer_expiry_capped_by_night.sql
-- The offer window was a flat offer_window_hours (default 24h) regardless of
-- when the night actually starts — a host picking 6h before the date handed
-- the candidate a clock that outlived the date itself (founder, 2026-06-12).
--
-- New rule: expires_at = least(window, night start - 2h), floored at 30
-- minutes from now (a host picking very late still yields a live, short
-- offer), and never past the night's start. The 2h buffer leaves room for
-- auto-roll to reach the next person in line with time to say yes.
--
-- Shipped as an OVERLOAD of offer_expires_at — the 1-arg form stays for any
-- other caller; match_make_offer now passes the instance's starts_at. The
-- function body below is the live prod definition verbatim except:
--   * `sta` declared + selected alongside creator_id/status,
--   * exp := offer_expires_at(now(), sta).
-- T-07: DEFINER, pinned search_path preserved.

create or replace function offer_expires_at(p_from timestamptz, p_starts_at timestamptz)
returns timestamptz language sql stable as $fn$
  select case
    when p_starts_at is null then offer_expires_at(p_from)
    else least(
      greatest(
        least(offer_expires_at(p_from), p_starts_at - interval '2 hours'),
        p_from + interval '30 minutes'
      ),
      p_starts_at
    )
  end
$fn$;

create or replace function match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  cre uuid;
  st  date_match_status;
  sta timestamptz;
  oid uuid;
  exp timestamptz;
  prior jsonb;
  reciprocal_offer uuid;
  both_dating_enabled boolean;
  lo uuid;
  hi uuid;
  v_pair_id uuid;
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  if not app_match_enabled(p_actor) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  prior := match_idem_lookup(p_actor, 'make_offer', p_idem_key);
  if prior is not null then return jsonb_build_object('kind','offer','offer_id', (prior->>'offer_id')::uuid); end if;

  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  select bool_and(dating_enabled) into both_dating_enabled
    from profiles where id in (p_actor, p_candidate);
  if not coalesce(both_dating_enabled, false) then
    raise exception 'account_gated' using errcode='P5002', detail='dating_disabled';
  end if;

  if exists (select 1 from blocks b
    where (b.blocker_id=p_actor and b.blocked_id=p_candidate)
       or (b.blocker_id=p_candidate and b.blocked_id=p_actor)) then
    raise exception 'account_gated' using errcode='P5002', detail='blocked';
  end if;

  select creator_id, status, starts_at into cre, st, sta from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
  if st <> 'seeking' then raise exception 'instance_not_seeking' using errcode='P0001'; end if;

  if exists (select 1 from offers where date_instance_id=p_instance and status='active') then
    raise exception 'offer_already_active' using errcode='P5003';
  end if;

  if not exists (select 1 from queue_entries
                  where date_instance_id=p_instance and candidate_id=p_candidate and status='shortlisted') then
    raise exception 'not_shortlisted' using errcode='P0002';
  end if;

  if not can_enter_lock_flow(p_candidate) then
    raise exception 'account_gated' using errcode='P5002', detail='candidate_not_eligible';
  end if;

  select id into reciprocal_offer from offers
    where creator_id = p_candidate
      and candidate_id = p_actor
      and date_instance_id <> p_instance
      and status = 'active'
    limit 1;
  if reciprocal_offer is not null then
    lo := least(p_actor, p_candidate);
    hi := greatest(p_actor, p_candidate);
    insert into reciprocal_pairs(low_user, high_user, status)
    values (lo, hi, 'open')
    on conflict (low_user, high_user) do update set status='open', resolved_at=null
    returning id into v_pair_id;
    perform dispatch_notification(p_actor, 'reciprocal_detected',
              jsonb_build_object('pair_id', v_pair_id, 'pair_offer_id', reciprocal_offer, 'my_pending_instance', p_instance));
    perform dispatch_notification(p_candidate, 'reciprocal_detected',
              jsonb_build_object('pair_id', v_pair_id, 'pair_offer_id', reciprocal_offer, 'my_pending_instance', p_instance));
    return jsonb_build_object('kind','reciprocal','pair_id', v_pair_id);
  end if;

  -- fix05: the window is capped by the night itself (2h buffer, 30min floor).
  exp := offer_expires_at(now(), sta);
  insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
  values (p_instance, p_candidate, cre, 'active', exp)
  returning id into oid;

  update queue_entries
     set status='offer_active', rank=1, offer_frozen_rank=1, updated_at=now()
   where date_instance_id=p_instance and candidate_id=p_candidate;

  perform open_chat_thread(oid);

  perform enqueue_job('offer_expiry', exp, jsonb_build_object('offer_id', oid), oid::text);

  perform dispatch_notification(p_candidate, 'offer_received',
            jsonb_build_object('instance', p_instance, 'offer_id', oid, 'expires_at', exp));

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_offer_made', p_actor, 'offer', oid,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate, 'expires_at', exp));

  perform match_idem_store(p_actor, 'make_offer', p_idem_key, jsonb_build_object('offer_id', oid));
  return jsonb_build_object('kind','offer','offer_id', oid);
end $fn$;
