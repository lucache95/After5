-- supabase/migrations/20260525123400_p2_notifications.sql
-- Append-only delivery log + the canonical notification_type enum (C1 + C11.11).
-- One row per (recipient, event); dispatch inserts it, then updates delivery
-- state. Also the backing store for an in-app notification center.
--
-- notification_type: C1 11-value base set + 4 C11.11 additions = 15 values total.
-- Idempotent enum creation per established convention.

do $$ begin
  create type notification_type as enum (
    'new_match','offer_received','offer_expiring','standby_promoted','date_reconfirm',
    'safety_checkin','safety_alert','new_message','rating_request','moderation_action','account',
    -- C11.11 additions (v2.1 contract):
    'verification_passed','verification_failed','appeal_resolved','offer_withdrawn'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_channel as enum ('push_ios','push_android','web_push','email','admin_alert','suppressed');
exception when duplicate_object then null; end $$;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  payload jsonb not null default '{}',   -- title/body/deep-link entity ids (C1: dispatch takes p_payload)
  dedup_key text,
  channel notification_channel,          -- chosen channel, 'suppressed', or 'admin_alert' (fail-loud)
  delivered boolean not null default false,
  delivery_error text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedup_uniq
  on notifications (type, dedup_key) where dedup_key is not null;
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;
do $$ begin
  create policy "notifications_recipient_read" on notifications for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "notifications_recipient_mark_read" on notifications for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- The recipient may ONLY mark-read, not mutate delivery/type/payload. RLS is row-level,
-- so restrict the writable surface at the column-grant layer: a table-level UPDATE grant
-- implicitly covers every column, so revoke it and re-grant only read_at. Without this a
-- user could flip their own delivered/channel (corrupt metrics) or type (game any future
-- query keyed on notifications.type). Service-role (dispatch) bypasses grants + RLS.
revoke update on notifications from authenticated, anon;
grant update (read_at) on notifications to authenticated;
