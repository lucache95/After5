-- Security hardening: lock down publicly-executable SECURITY DEFINER functions
-- and tighten the overly-permissive anon UPDATE policy on public.plan_votes.
--
-- WHY: the Supabase security advisor (prod ref ufufmcpnysvwtutpbian) flagged:
--   * public.handle_new_user()  - SECURITY DEFINER, EXECUTE granted to anon +
--     authenticated, callable via /rest/v1/rpc/handle_new_user. It is actually
--     the auth.users AFTER INSERT trigger (on_auth_user_created) that seeds
--     public.profiles. It must NEVER be invokable as an RPC.
--   * public.rls_auto_enable() - SECURITY DEFINER, EXECUTE granted to anon +
--     authenticated. It is a DDL ddl_command_end EVENT TRIGGER (ensure_rls)
--     that auto-enables RLS on new public tables. Pure internal maintenance.
--   * public.plan_votes "plan votes anon update" - UPDATE policy with
--     USING(true) + WITH CHECK(true): any anon caller could rewrite ANY row
--     (vote manipulation / hijack of other voters' rows).
--
-- DRIFT NOTE: handle_new_user() and rls_auto_enable() exist on PROD only; they
-- are not defined in any local migration. The REVOKE statements are therefore
-- guarded so this migration runs cleanly on prod (where they exist) AND locally
-- (where they do not). plan_votes DOES exist locally.
--
-- Revoking EXECUTE does NOT stop a trigger / event-trigger from firing: trigger
-- functions run as the table owner / definer regardless of the caller's EXECUTE
-- grant. So profile-seeding on signup and auto-RLS on CREATE TABLE keep working;
-- only the public RPC surface is removed.
--
-- SECURE-BY-DEFAULT CONVENTION (governs all future tables/policies):
--   Pick ONE reusable pattern per table, never bespoke true-everywhere policies:
--     (a) owner-CRUD     : USING (auth.uid() = user_id) for select/insert/update/delete.
--     (b) public-read    : anon+authenticated SELECT USING(true); writes restricted/none.
--     (c) public-insert  : anon INSERT only (feedback/signups/voting); NO anon
--                          select/update/delete; add a DB constraint/rate-limit if abuse-prone.
--     (d) service-role   : RLS ENABLED, ZERO policies (service role bypasses RLS).
--   HARD RULE: NEVER USING(true) / WITH CHECK(true) on UPDATE or DELETE for
--   anon/authenticated. Keep RLS enabled (default-deny). Re-run the security
--   advisor after ANY DDL and resolve new findings.

-- ---------------------------------------------------------------------------
-- FIX 1: remove the public RPC surface from the two SECURITY DEFINER functions.
-- Guarded so it is a no-op where the function is absent (local drift).
-- ---------------------------------------------------------------------------
do $$
begin
  revoke execute on function public.handle_new_user() from anon, authenticated, public;
exception
  when undefined_function then null;  -- prod-only object; skip locally
end $$;

do $$
begin
  revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
exception
  when undefined_function then null;  -- prod-only object; skip locally
end $$;

-- ---------------------------------------------------------------------------
-- FIX 2: tighten the anon UPDATE policy on public.plan_votes.
--
-- Votes are anonymous: rows are keyed by (session_id, voter_token) (UNIQUE),
-- where voter_token is a client-supplied localStorage id. The app re-votes via
-- an upsert ON CONFLICT (session_id, voter_token), so the conflict path issues
-- an UPDATE that must keep working. There is NO server-trusted owner key for
-- the anon role (no auth.uid(), no session GUC), so a fully tamper-proof
-- per-row scope is not expressible. The original USING(true)/WITH CHECK(true)
-- is replaced with the strongest honest scope: the identity columns must stay
-- non-null and the referenced vote_session must exist. This blocks blanking /
-- corrupting the keys and orphaning rows, but a determined anon who knows
-- another voter_token could still target that row (see OPEN QUESTION in report).
-- The always-true INSERT policy ("plan votes anon insert") is intentional and
-- is left untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "plan votes anon update" on public.plan_votes;

create policy "plan votes anon update" on public.plan_votes
  for update to anon
  using (
    session_id is not null
    and voter_token is not null
    and exists (select 1 from public.vote_sessions vs where vs.id = plan_votes.session_id)
  )
  with check (
    session_id is not null
    and voter_token is not null
    and exists (select 1 from public.vote_sessions vs where vs.id = plan_votes.session_id)
  );

-- NOT TOUCHED (intentional anon-INSERT flows): plan_votes "plan votes anon insert",
-- plan_feedback "anon insert feedback", user_feedback "anyone can submit feedback",
-- subscribers "subscribers_insert_anon", vote_sessions "vote sessions anon insert".
-- NOT INCLUDED: itinerary_reviews / place_reviews are service-role-only (pattern d),
-- not user-facing; their no-policy state is correct. Left for human confirmation.
