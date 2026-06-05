-- supabase/migrations/20260606140200_e24_withdraw_interest.sql
-- E24 (REQ-E24): candidate-side plain-interest withdraw.
--
-- A lighter sibling of match_withdraw (20260527126800_p5_pass_expire_withdraw.sql:87-118):
-- it deletes ONLY the caller's own `interested` queue_entries row for one instance.
-- queue_entries is default-deny on write (C7, 20260525120500_p0_queue_entries.sql:23-26):
-- there is NO insert/update/delete RLS policy, so a SECURITY DEFINER RPC is the only
-- correct mutation path. This is the offer-stage withdraw's pre-offer counterpart.
--
-- Deliberately DROPS everything match_withdraw does beyond the auth gate:
--   * no match_v2_enabled feature gate (a pending interest is not v2-gated)
--   * no advisory lock / offer resolution (there is no active offer at the interest stage)
--   * no creator notification (a pre-offer withdraw is silent)
-- Status-scoped to 'interested' so a shortlisted / offer_* / locked / standby row is never
-- touched (T-07-08). Re-swipe-after-withdraw is allowed: this deletes the interest only and
-- leaves the swipe row intact (MVP simplest, D-24).
--
-- PARAM ORDER (locked correction): required param precedes the defaulted one.

create or replace function withdraw_interest(p_instance uuid, p_actor uuid default auth.uid())
returns void language plpgsql security definer set search_path = public as $fn$
begin
  -- T-07-07 elevation-of-privilege: only the row's own candidate may withdraw it.
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  -- T-07-08 tampering: status-scoped to 'interested' so shortlisted/offer_*/locked/standby
  -- rows are never deleted. candidate_id = p_actor is the per-row ownership predicate.
  delete from queue_entries
    where date_instance_id = p_instance
      and candidate_id = p_actor
      and status = 'interested';
end $fn$;

-- A.7 hardening: queue_entries writes are RPC-only; lock execute down to authenticated.
revoke execute on function withdraw_interest(uuid, uuid) from public, anon;
grant execute on function withdraw_interest(uuid, uuid) to authenticated;
