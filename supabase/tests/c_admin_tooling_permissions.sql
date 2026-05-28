-- supabase/tests/c_admin_tooling_permissions.sql
-- C-SQL: admin support tools must be service_role-only.
-- VERIFIED against migration 20260527127000_p5_c_sql.sql §5 REVOKE pass:
--   revoke all on function admin_force_expire_offer(uuid)        from public, anon, authenticated;
--   revoke all on function admin_force_cancel_lock(uuid, text)   from public, anon, authenticated;
-- These functions are SECURITY DEFINER with no auth.uid() check, so EXECUTE
-- must NOT be reachable by anon/authenticated. service_role retains EXECUTE.
-- Follows the negative-authz style of a_revealed_rls_negative.sql.
\i supabase/tests/_fixtures.sql

DO $$
DECLARE
  exp_anon  boolean;
  exp_auth  boolean;
  exp_svc   boolean;
  can_anon  boolean;
  can_auth  boolean;
  can_svc   boolean;
BEGIN
  -- ---- admin_force_expire_offer(uuid) ----
  exp_anon := has_function_privilege('anon',          'admin_force_expire_offer(uuid)', 'EXECUTE');
  exp_auth := has_function_privilege('authenticated', 'admin_force_expire_offer(uuid)', 'EXECUTE');
  exp_svc  := has_function_privilege('service_role',  'admin_force_expire_offer(uuid)', 'EXECUTE');

  IF exp_anon THEN RAISE EXCEPTION 'C.admin: anon MUST NOT execute admin_force_expire_offer'; END IF;
  IF exp_auth THEN RAISE EXCEPTION 'C.admin: authenticated MUST NOT execute admin_force_expire_offer'; END IF;
  IF NOT exp_svc THEN RAISE EXCEPTION 'C.admin: service_role MUST be able to execute admin_force_expire_offer'; END IF;
  RAISE NOTICE 'C.admin: admin_force_expire_offer revoked from anon+authenticated, allowed for service_role OK';

  -- ---- admin_force_cancel_lock(uuid, text) ----
  can_anon := has_function_privilege('anon',          'admin_force_cancel_lock(uuid, text)', 'EXECUTE');
  can_auth := has_function_privilege('authenticated', 'admin_force_cancel_lock(uuid, text)', 'EXECUTE');
  can_svc  := has_function_privilege('service_role',  'admin_force_cancel_lock(uuid, text)', 'EXECUTE');

  IF can_anon THEN RAISE EXCEPTION 'C.admin: anon MUST NOT execute admin_force_cancel_lock'; END IF;
  IF can_auth THEN RAISE EXCEPTION 'C.admin: authenticated MUST NOT execute admin_force_cancel_lock'; END IF;
  IF NOT can_svc THEN RAISE EXCEPTION 'C.admin: service_role MUST be able to execute admin_force_cancel_lock'; END IF;
  RAISE NOTICE 'C.admin: admin_force_cancel_lock revoked from anon+authenticated, allowed for service_role OK';
END $$;

-- Cross-check against role_routine_grants: no EXECUTE grant rows should exist for
-- anon/authenticated on either admin function. (PUBLIC default was also revoked.)
DO $$
DECLARE leaked int;
BEGIN
  SELECT count(*) INTO leaked
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND routine_name IN ('admin_force_expire_offer', 'admin_force_cancel_lock')
    AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    AND privilege_type = 'EXECUTE';
  IF leaked <> 0 THEN
    RAISE EXCEPTION 'C.admin: found % leaked EXECUTE grant(s) to anon/authenticated/PUBLIC on admin tools', leaked;
  END IF;
  RAISE NOTICE 'C.admin: role_routine_grants shows no anon/authenticated/PUBLIC EXECUTE rows OK';
END $$;

-- NOTE: a runtime "call as authenticated and expect insufficient_privilege" check
-- was intentionally NOT added. Because these are SECURITY DEFINER functions owned by
-- a superuser, the privilege gate is EXECUTE alone; invoking the body to observe the
-- denial drags in real business logic (match_resolve_offer_negative / lock cancel)
-- that can abort the session. The catalog assertions above (has_function_privilege +
-- role_routine_grants) prove the REVOKE faithfully and without side effects.

DO $$ BEGIN RAISE NOTICE 'C.admin: all admin-tooling permission assertions OK'; END $$;
