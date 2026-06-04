-- 20260604122000_e6_cancel_night.sql
-- Phase 02 (Loop Closure & Host Controls) Wave 2 — E6 cancel_night (D-04 / D-06).
--
-- cancel_night(p_actor, p_instance, p_idem_key) — DEFINER RPC, CREATOR-ONLY.
--   SOFT unpublish of the creator's OWN pre-match 'seeking' night: flip
--   date_instances.status -> 'cancelled' (the row + all queue_entries/interest data are
--   KEPT — reversible, NOT a hard delete, D-04). The cancelled status removes the night
--   from feed eligibility (browse_feed only surfaces 'seeking').
--   Then NOTIFY every already-interested candidate via the new 'night_cancelled'
--   notification (D-04: respect the people who swiped in) so they are never left
--   waiting on a dead night.
--
-- Skeleton copied verbatim from match_make_offer (20260527126300_p5_make_offer.sql):
--   auth.uid() re-check (P5001) + idempotency replay (match_idem_lookup/store) +
--   pg_advisory_xact_lock(match_instance_lock_key) + creator-only ownership check (42501)
--   + dispatch_notification (performed INSIDE the DEFINER only) + analytics_events.
--
-- Security (D-06 / T-02-09..11): SECURITY DEFINER + set search_path=public; auth re-check
--   AND creator-only ownership check (NOT broadened RLS — NO USING(true)); dispatch_notification
--   is revoked from public and only performed inside this DEFINER; revoke execute from
--   public/anon, grant to authenticated (auth is enforced inside the body).
--
-- Pre-match only (D-04): a matched/locked night is past the point of a soft unpublish; only a
--   'seeking' night may be cancelled (st <> 'seeking' -> 'not_cancellable' P0001).
--
-- GATED — LOCAL ONLY this phase. Prod apply is owner-approved and batched separately; do NOT
-- db:push this from here. Depends on 20260604120000 (the 'night_cancelled' enum value).

create or replace function cancel_night(p_actor uuid, p_instance uuid, p_idem_key uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare
  cre uuid;
  st  date_match_status;
  rec record;
  prior jsonb;
begin
  -- 1. C10 auth re-check — the actor must be the caller.
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- 2. idempotency replay — a second call with the same key is a clean no-op (no double-notify).
  prior := match_idem_lookup(p_actor, 'cancel_night', p_idem_key);
  if prior is not null then return; end if;

  -- 3. serialize all offer/lock/cancel activity for this instance.
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  -- 4. load + null-check + CREATOR-ONLY ownership check + pre-match state check.
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
  if st <> 'seeking' then raise exception 'not_cancellable' using errcode='P0001'; end if;  -- pre-match only (D-04)

  -- 5. SOFT unpublish (D-04): flip status, KEEP the row + all queue_entries/interest data.
  --    'cancelled' is excluded from feed eligibility (browse_feed surfaces only 'seeking').
  update date_instances set status='cancelled', updated_at=now() where id=p_instance;

  -- 6. notify already-interested candidates (D-04). dedup_key collapses a duplicate dispatch
  --    to one notification row per (instance, candidate) so a retry doesn't double-notify.
  for rec in
    select candidate_id from queue_entries
     where date_instance_id=p_instance
       and status in ('interested','shortlisted','standby')   -- pre-match interest only
  loop
    perform dispatch_notification(rec.candidate_id, 'night_cancelled',
      jsonb_build_object(
        'date_instance_id', p_instance,
        'dedup_key', 'night_cancelled:'||p_instance::text||':'||rec.candidate_id::text));
  end loop;

  -- 7. analytics.
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('night_cancelled', p_actor, 'date_instance', p_instance, jsonb_build_object());

  -- 8. record idempotency.
  perform match_idem_store(p_actor, 'cancel_night', p_idem_key, jsonb_build_object('ok', true));
end $fn$;

-- Public C2 RPC: auth enforced inside (auth.uid() re-check + creator-only). Revoke from
-- public/anon; grant to authenticated only.
revoke execute on function cancel_night(uuid, uuid, uuid) from public, anon;
grant  execute on function cancel_night(uuid, uuid, uuid) to authenticated;
