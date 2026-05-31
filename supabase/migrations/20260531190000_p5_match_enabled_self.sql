-- 20260531190000_p5_match_enabled_self.sql
-- Client-callable self-gate.
--
-- app_match_enabled_self() returns whether the CURRENT authenticated user
-- (auth.uid()) is matching-enabled = global flag `match_v2_enabled` ON OR the
-- user is in the `match_cohort` allowlist. It wraps app_match_enabled(auth.uid())
-- so the web UI match pages can gate on the cohort allowlist instead of reading
-- the raw global flag directly. With this, the global flag can stay OFF while a
-- cohort uses the loop, and the UI matches the RPC gate.
--
-- Takes NO argument so a caller can only ever check THEIR OWN status — no probing
-- arbitrary user_ids for cohort membership.
--
-- SECURITY DEFINER: app_match_enabled has EXECUTE revoked from authenticated
-- (see 20260527127800_p5_match_cohort_allowlist.sql), so this wrapper — running
-- as owner — is how a logged-in client reaches the gate. auth.uid() still
-- resolves to the caller's uid inside a DEFINER function: it reads the request
-- JWT claims, which are independent of the executing role.

create or replace function app_match_enabled_self()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_match_enabled(auth.uid());
$$;

-- Default-deny, then grant to logged-in users only. PUBLIC's implicit execute is
-- stripped; anon stays denied (the pages require an authenticated session).
revoke all on function app_match_enabled_self() from public, anon;
grant execute on function app_match_enabled_self() to authenticated;
