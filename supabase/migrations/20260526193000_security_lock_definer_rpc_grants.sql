-- Secure-by-default lockdown of SECURITY DEFINER function EXECUTE grants.
--
-- WHY: the dating backend functions were created under Supabase's default
-- privileges, which auto-grant EXECUTE to anon + authenticated. That exposes
-- internal functions (jobs queue, notifications, admin alerts, verification
-- rollup, age-gate/notif-prefs triggers, chat/lock internals) as public REST
-- RPCs that run with owner privileges and bypass RLS — an abuse surface
-- (queue tampering, spam notifications, forged admin alerts).
--
-- FIX: revoke EXECUTE from anon/authenticated/public on every NON-extension
-- SECURITY DEFINER function in public, EXCEPT the two the client legitimately
-- calls as RPCs (advance_onboarding_step, register_device) which keep
-- authenticated. service_role keeps its own explicit grant (used by the edge
-- functions), so the job/notification pipeline is unaffected. Revoking EXECUTE
-- does not stop trigger functions from firing. PostGIS functions (st_*) are
-- left to the separate extension-relocation task.
--
-- Idempotent: REVOKE is a no-op when the grant is already absent.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('advance_onboarding_step', 'register_device')
      and not exists (
        select 1
        from pg_depend d
        join pg_extension e on e.oid = d.refobjid and e.extname in ('postgis', 'btree_gist')
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', r.sig);
  end loop;
end $$;

-- Client-called RPCs: drop anon + public, keep authenticated (+ service_role).
revoke execute on function public.advance_onboarding_step(text) from anon, public;
revoke execute on function public.register_device(text, text, jsonb) from anon, public;
