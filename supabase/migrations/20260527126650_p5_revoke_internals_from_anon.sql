-- 20260527126650_p5_revoke_internals_from_anon.sql
-- A.7 hardening: lock down match_* SECURITY DEFINER functions from anon.
--
-- Supabase auto-grants EXECUTE on new public functions to `anon`, `authenticated`,
-- and `service_role` via default privileges. `REVOKE EXECUTE ... FROM public,
-- authenticated` alone leaves anon access intact, and on some PG configs a plain
-- `revoke execute` doesn't remove implicit defaults. Use `revoke all ... from
-- public, anon` to fully strip access.
--
-- Public C2 RPCs (shortlist/make_offer/accept_offer) remain authenticated-callable
-- via auth.uid()=p_actor check inside; internal helpers are service-role-only.

revoke all on function public.match_ingest_interest(uuid) from public, anon, authenticated;
revoke all on function public.match_next_standby(uuid) from public, anon, authenticated;
revoke all on function public.match_idem_lookup(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.match_idem_store(uuid, text, uuid, jsonb) from public, anon, authenticated;
-- match_reveal_allowed_pair: must remain EXECUTABLE by authenticated because it's
-- referenced from the profiles_select_revealed RLS policy. PG evaluates the function
-- call in the calling role's privilege context (despite SECURITY DEFINER inside).
-- Without EXECUTE, the SELECT crashes the server (known PG quirk in this Supabase build).
-- The function returns bool only — no PII leak surface. Keep authenticated; lock anon.
revoke all on function public.match_reveal_allowed_pair(uuid, uuid) from public, anon;
grant execute on function public.match_reveal_allowed_pair(uuid, uuid) to authenticated;

-- Public C2 RPCs: revoke anon (keep authenticated)
revoke all on function public.match_shortlist(uuid, uuid, uuid, integer) from public, anon;
revoke all on function public.match_make_offer(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.match_accept_offer(uuid, uuid, uuid) from public, anon;

-- match_reveal_allowed is a predicate; authenticated can call it for UI logic
revoke all on function public.match_reveal_allowed(uuid, uuid) from public, anon;
