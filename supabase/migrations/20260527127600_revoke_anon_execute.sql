-- 20260527127600_revoke_anon_execute.sql
-- 5b deploy-audit hardening (low risk): revoke anon EXECUTE on four SECURITY DEFINER
-- RPCs that are user-context only. These were created with the default PUBLIC grant,
-- which leaks anon EXECUTE. Each enforces auth.uid() internally, so anon could never
-- act on another user's behalf — but an unauthenticated caller should not be able to
-- invoke a SECURITY DEFINER user RPC at all. `authenticated` retains EXECUTE (these are
-- the public C2/feed/swipe surfaces); only the anon grant is stripped.
--
-- Verified on prod 2026-05-29: all four had anon EXECUTE = true, authenticated = true,
-- single overload each, prosecdef = true. Idempotent: REVOKE on an already-revoked
-- grant is a no-op.
--   record_swipe(p_instance uuid, p_direction swipe_direction)            -- S5 swipe
--   post_night(p_itinerary uuid, p_starts_at timestamptz, p_venue uuid, p_duration_min int) -- S5 post-night
--   browse_feed_for_viewer(p_viewer uuid, p_point geography, p_after_starts timestamptz, p_after_id uuid, p_limit int) -- S4 feed
--   match_reveal_allowed(p_viewer uuid, p_instance uuid)                  -- reveal predicate

-- record_swipe / post_night / browse_feed_for_viewer already had the PUBLIC grant
-- stripped at creation, so revoking the anon grant fully removes anon EXECUTE.
revoke execute on function public.record_swipe(uuid, swipe_direction) from anon;
revoke execute on function public.post_night(uuid, timestamptz, uuid, integer) from anon;
revoke execute on function public.browse_feed_for_viewer(uuid, geography, timestamptz, uuid, integer) from anon;

-- match_reveal_allowed still carries the implicit PUBLIC EXECUTE grant (=X in proacl),
-- so anon inherits EXECUTE via PUBLIC. Revoking from anon alone is a no-op there; we must
-- revoke from PUBLIC to strip the implicit anon access. authenticated/service_role keep
-- their explicit grants, so the user-context callers are unaffected.
revoke execute on function public.match_reveal_allowed(uuid, uuid) from anon;
revoke execute on function public.match_reveal_allowed(uuid, uuid) from public;
