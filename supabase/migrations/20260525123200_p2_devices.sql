-- supabase/migrations/20260525123200_p2_devices.sql
-- Push-token registry (INTEGRATION-CONTRACT C11.2 — supersedes the C1 composite-PK
-- form, which was a compile-breaker). Mobile (Expo) registers its push token on
-- app start; web registers its Web Push (VAPID) subscription. Dispatch reads
-- active rows via the service-role client.

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  expo_push_token text,
  web_push_sub jsonb,
  platform text,
  last_seen timestamptz not null default now(),
  -- NULLS NOT DISTINCT: one row per (user, expo_push_token); a null token (web-only)
  -- collapses to a single slot per user, so a 2nd browser's web_push_sub upserts over
  -- the first. Intentional — native push is load-bearing, web push is best-effort (no
  -- multi-browser web delivery). Each native device has a distinct token => its own row.
  unique nulls not distinct (user_id, expo_push_token)
);
create index if not exists devices_user_idx on devices (user_id);

alter table devices enable row level security;
do $$ begin
  create policy "devices_owner_all" on devices for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- register_device(p_token, p_platform, p_web_push) — called from P1/S3 onboarding
-- + native bootstrap. Upserts the caller's device row (auth.uid()), refreshes
-- last_seen. C1 signature.
create or replace function register_device(
  p_token text, p_platform text, p_web_push jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'register_device requires an authenticated user'; end if;
  insert into devices (user_id, expo_push_token, web_push_sub, platform, last_seen)
  values (v_uid, p_token, p_web_push, p_platform, now())
  on conflict (user_id, expo_push_token) do update
    set web_push_sub = excluded.web_push_sub,
        platform     = excluded.platform,
        last_seen    = now()
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function register_device(text, text, jsonb) from public;
-- authenticated keeps execute (a user registers their own device via auth.uid()).
