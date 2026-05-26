-- supabase/migrations/20260525123500_p2_can_enter_lock_flow.sql
-- P5 lock-flow gate (INTEGRATION-CONTRACT C3). Defined in S2 so S6/P5 can call it
-- before S8 ships the standing ladder. Reads the two orthogonal C3 fields on
-- profiles (account_state owner P9/S10; standing owner P7/S8) + rollover_frozen,
-- all added in S1. P5's match_make_offer/match_accept_offer MUST call it (C2).
-- C3 exact logic: account_state='active' AND standing NOT IN ('cooldown','locked_ban','suspended')
-- AND NOT rollover_frozen. A 'paused' user also returns false (C11.9).

create or replace function can_enter_lock_flow(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = p_user
       and account_state = 'active'
       and standing not in ('cooldown','locked_ban','suspended')
       and coalesce(rollover_frozen, false) = false
  );
$$;
-- predicate read by P5 RPCs (SECURITY DEFINER); keep revoked from direct callers.
revoke execute on function can_enter_lock_flow(uuid) from public, authenticated;
