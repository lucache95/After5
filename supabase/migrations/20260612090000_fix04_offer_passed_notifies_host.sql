-- 20260612090000_fix04_offer_passed_notifies_host.sql
-- The candidate who PASSED an offer was receiving the offer_passed
-- notification about their own action — "they passed this time" landed in the
-- passer's inbox (founder live-test 2026-06-12). The host is the party who
-- needs to learn their pick declined; the inbox copy was always written from
-- the host's perspective.
--
-- Change (surgical): match_resolve_offer_negative now dispatches
--   passed  → offers.creator_id (the host)
--   expired → candidate (unchanged — "an offer ran out" is candidate copy)
-- Everything else (advisory lock, status flips, chat close, job cancel,
-- auto-roll) is verbatim from the live prod definition. T-07: DEFINER,
-- pinned search_path, internal function (no grants to anon/authenticated).

create or replace function match_resolve_offer_negative(p_offer uuid, p_terminal offer_status)
returns int language plpgsql security definer set search_path=public as $fn$
declare inst uuid; cand uuid; cre uuid; ostatus offer_status;
begin
  select date_instance_id, candidate_id, creator_id, status into inst, cand, cre, ostatus
    from offers where id=p_offer;
  if inst is null then return 0; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(inst));
  select status into ostatus from offers where id=p_offer for update;
  if ostatus <> 'active' then return 0; end if;
  update offers set status=p_terminal, resolved_at=now() where id=p_offer;
  update queue_entries
     set status = case when p_terminal='passed' then 'offer_passed'::queue_status
                       else 'offer_expired'::queue_status end,
         updated_at = now()
   where date_instance_id=inst and candidate_id=cand;
  perform close_chat_thread(p_offer);
  perform cancel_jobs('offer_expiry', p_offer::text);
  if p_terminal = 'passed' then
    -- fix04: the HOST gets told their pick declined (was: the passer themselves).
    perform dispatch_notification(cre, 'offer_passed', jsonb_build_object('offer_id', p_offer, 'instance', inst));
  else
    perform dispatch_notification(cand, 'offer_expired', jsonb_build_object('offer_id', p_offer, 'instance', inst));
  end if;
  perform match_auto_roll(inst);
  return 1;
end $fn$;
