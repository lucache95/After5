-- supabase/migrations/20260525123700_p2_admin_alerts.sql
-- Admin-alert channel — the "fail loud" terminus (INTEGRATION-CONTRACT C11.8).
-- A safety notification with no deliverable device inserts a row here AND (via
-- notify.ts) emails ops; it never dead-ends in an empty channel. P7/S8 + P8/S9
-- consume this table (admin console + safety escalation).

create table if not exists admin_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists admin_alerts_open_idx on admin_alerts (created_at desc) where resolved_at is null;

alter table admin_alerts enable row level security;
-- Service-role + admin-only (admin RLS added by P8/S9 admin console using
-- admin_has_role()); no anon/authenticated access by default.

create or replace function raise_admin_alert(p_kind text, p_payload jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into admin_alerts (kind, payload) values (p_kind, coalesce(p_payload,'{}'))
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function raise_admin_alert(text, jsonb) from public, authenticated;
