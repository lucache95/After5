-- Drift capture: version-control two SECURITY DEFINER functions + their triggers
-- that, until now, existed ONLY on the production database (ref ufufmcpnysvwtutpbian)
-- and were absent from every local migration. This made the onboarding flow
-- impossible to exercise locally, because a new auth.users signup never produced a
-- public.profiles row on the dev DB (no on_auth_user_created trigger existed).
--
-- WHY THIS MIGRATION:
--   * Restore local <-> prod parity so the onboarding wizard can be tested locally.
--   * Get these critical objects into source control (they were a hidden dependency).
--
-- WHAT IT RECREATES (faithfully, byte-for-byte from prod -- NOT "improved"):
--   1. public.handle_new_user()  -> AFTER INSERT trigger on_auth_user_created on
--      auth.users; seeds public.profiles (id, email, first_name) on signup.
--   2. public.rls_auto_enable()  -> ddl_command_end EVENT TRIGGER ensure_rls;
--      auto-enables RLS on newly CREATEd public tables.
--
-- NOTE on EXECUTE grants: the earlier security migration
--   (20260526185247_security_revoke_definer_rpc_and_plan_votes_rls.sql) REVOKEs
--   EXECUTE on both functions from anon/authenticated/public. These functions are
--   only ever invoked as a trigger / event trigger (which run as the definer/owner
--   regardless of the caller's grant), so we deliberately DO NOT grant EXECUTE here.
--   That security migration runs BEFORE this one, but its REVOKEs are guarded with
--   `exception when undefined_function` -- so on a fresh local DB it was a no-op for
--   these (then-absent) functions, and the functions are created here grant-free,
--   which matches the desired hardened end-state.
--
-- NOTE on the event trigger: once ensure_rls exists locally, any `create table` in
--   the public schema from FUTURE local migrations will auto-get RLS enabled. This
--   migration sits near the end of the current timeline, so it only affects tables
--   created after it -- existing tables are unaffected.
--
-- SAFETY: idempotent (create or replace; drop ... if exists before create). This is
-- being applied to LOCAL only; it is NOT applied to prod (the objects already live
-- on prod -- this re-running there would be a faithful no-op, but we are not doing so).

-- ---------------------------------------------------------------------------
-- 1. handle_new_user() + on_auth_user_created trigger on auth.users
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, first_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'first_name',
      new.raw_user_meta_data ->> 'given_name',
      split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1),
      null
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. rls_auto_enable() + ensure_rls ddl_command_end event trigger
-- ---------------------------------------------------------------------------
create or replace function public.rls_auto_enable()
  returns event_trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  execute function public.rls_auto_enable();

-- ---------------------------------------------------------------------------
-- 3. Harden advance_onboarding_step(text): FAIL LOUD when the UPDATE matches no
--    profiles row (previously a missing profiles row was silently ignored and the
--    target step was still returned). Forward-only / backward-rejection behavior,
--    signature, and return type are unchanged. (This function IS in a local
--    migration -- 20260525122800 -- so this is a normal create-or-replace.)
-- ---------------------------------------------------------------------------
create or replace function advance_onboarding_step(p_to_step text)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  steps text[] := array['age_gate','basics','photos','preferences','phone_verify','selfie_verify','done'];
  cur text; cur_ix int; new_ix int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'advance_onboarding_step: not authenticated'; end if;
  new_ix := array_position(steps, p_to_step);
  if new_ix is null then raise exception 'advance_onboarding_step: invalid step %', p_to_step; end if;
  select onboarding_step into cur from profiles where id = uid;
  cur_ix := array_position(steps, cur);
  if new_ix <= cur_ix then
    raise exception 'advance_onboarding_step: cannot move backward (% -> %)', cur, p_to_step;
  end if;
  update profiles set onboarding_step = p_to_step,
    onboarding_completed_at = case when p_to_step = 'done' then now() else onboarding_completed_at end
   where id = uid;
  if not found then
    raise exception 'advance_onboarding_step: no profiles row for %', uid;
  end if;
  return p_to_step;
end $fn$;
revoke execute on function advance_onboarding_step(text) from public;
grant execute on function advance_onboarding_step(text) to authenticated;
