-- supabase/migrations/20260525120900_p0_reports_blocks.sql
create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (blocker_id <> blocked_id)
);
create unique index if not exists blocks_unique_blocker_blocked
  on blocks (blocker_id, blocked_id);

-- C5/C11.6 canonical enums (frozen taxonomy + 4-value status).
do $$ begin
  create type report_status as enum ('open','reviewing','actioned','dismissed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type report_reason_category as enum
    ('harassment','safety_threat','no_show_dispute','payment_dispute','inappropriate_content','fake_profile','other');
exception when duplicate_object then null; end $$;

-- C5/C11.6 canonical reports shape. target_id is intentionally FK-less (polymorphic).
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete set null,
  target_type text not null check (target_type in ('user','date_instance','message','lock')),
  target_id uuid not null,
  reason_category report_reason_category not null,
  detail text,
  status report_status not null default 'open',
  resolution_code text,
  pay_setting_snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on reports(status);

-- C11.6 canonical disputes DDL (verbatim).
create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  raised_by uuid not null references profiles(id),
  kind text not null check (kind in ('no_show','payment','conduct')),
  state text not null default 'open' check (state in ('open','resolved','rejected')),
  resolution jsonb,
  created_at timestamptz not null default now()
);
create index if not exists disputes_lock_idx on disputes(lock_id);

alter table blocks enable row level security;
alter table reports enable row level security;
alter table disputes enable row level security;
do $$ begin
  create policy "blocks_owner_all" on blocks for all
    using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- reporters insert via file_report (S9) which asserts auth.uid(); direct insert is gated to self.
  create policy "reports_reporter_insert" on reports for insert
    with check (reporter_id = auth.uid());
exception when duplicate_object then null; end $$;
-- report/dispute review/read is service-role/admin only (no select policy = default deny).
-- disputes writes happen via S8 (raise) / S9 (resolve) RPCs; no direct write policy here.
