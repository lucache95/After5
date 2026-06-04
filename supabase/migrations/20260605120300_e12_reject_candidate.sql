-- 20260605120300_e12_reject_candidate.sql
-- E12 (REQ-E12 / D-04 / D-09): reject_candidate — the host dismisses a candidate
-- without progressing them. SILENT decline: the rejected candidate is NEVER
-- notified (D-04 — broadcasting a rejection is off-brand). They simply stop
-- progressing and drop out of the host's active interested list.
--
-- Copied from the match_make_offer DEFINER exemplar (20260527126300_p5_make_offer.sql)
-- but STRIPPED of all offer-specific machinery: no idempotency-ledger replay, no
-- reciprocal detection, no chat thread, no expiry job, and — critically — NO
-- dispatch_notification to the candidate.
--
-- Posture (03-PATTERNS §"DEFINER RPC skeleton" + §"Anon-revoke on new RPCs"):
--   1. auth.uid() = p_actor               (P5001)
--   2. feature flag match_v2_enabled      (P5000)
--   3. advisory-lock the instance         (serialize vs make_offer/roll)
--   4. creator-ownership recheck          (P0002 no instance / 42501 non-creator)
--   5. cannot reject the active offer-holder (P0001 — withdraw the offer first, D-09)
--   6. set queue_entry -> passed_by_host  (enum from 20260605120100)
--   7. record analytics_events            (no notification)
-- Idempotent: re-running on an already-passed_by_host row is a no-op success.

create or replace function reject_candidate(
  p_actor uuid,
  p_instance uuid,
  p_candidate uuid
)
returns void language plpgsql security definer set search_path=public as $fn$
declare
  cre uuid;
  v_updated int;
begin
  -- 1. auth: actor must be the JWT subject
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- 2. feature flag (P5000)
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;

  -- 3. serialize all offer/lock/roll/reject activity for this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  -- 4. instance + creator-ownership recheck
  select creator_id into cre from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;

  -- 5. guard: cannot reject the active offer-holder — pull the offer first (D-09)
  if exists (select 1 from queue_entries
              where date_instance_id=p_instance
                and candidate_id=p_candidate
                and status='offer_active') then
    raise exception 'cannot_reject_active_offer' using errcode='P0001';
  end if;

  -- 6. mutate: move a live (interested/shortlisted/standby) entry to passed_by_host
  update queue_entries
     set status='passed_by_host'::queue_status, updated_at=now()
   where date_instance_id=p_instance
     and candidate_id=p_candidate
     and status in ('interested','shortlisted','standby');
  get diagnostics v_updated = row_count;

  -- Idempotency: a second reject on an already-passed_by_host row updates nothing
  -- but is a NO-OP SUCCESS, not an error. Only raise not_rejectable when the
  -- candidate is in no rejectable/already-rejected state for this instance.
  if v_updated = 0 then
    if not exists (select 1 from queue_entries
                    where date_instance_id=p_instance
                      and candidate_id=p_candidate
                      and status='passed_by_host') then
      raise exception 'not_rejectable' using errcode='P0002';
    end if;
    return;  -- already passed_by_host → idempotent no-op
  end if;

  -- 7. analytics (NOT a notification). SILENT (D-04): no dispatch_notification anywhere.
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('candidate_rejected', p_actor, 'queue_entry', p_candidate,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate));
  -- SILENT (D-04): the rejected candidate is deliberately NOT notified.
end $fn$;

-- Anon-revoke posture (03-PATTERNS Pitfall 2): Supabase auto-grants EXECUTE to anon
-- on new public functions; revoke from public is NOT enough — revoke from anon too.
revoke execute on function reject_candidate(uuid, uuid, uuid) from public;
revoke execute on function reject_candidate(uuid, uuid, uuid) from anon;
grant  execute on function reject_candidate(uuid, uuid, uuid) to authenticated;
