-- supabase/migrations/20260525123000_p2_jobs.sql
-- THE canonical jobs table (INTEGRATION-CONTRACT C1). Single source; no other
-- phase creates a jobs table. A row = one timer the mechanic needs to fire.
-- A Vercel cron (every minute) invokes process-jobs, which claims due rows
-- (status='pending', run_after<=now()) with FOR UPDATE SKIP LOCKED, dispatches
-- per `type`, retries with backoff, dead-letters at attempts>=5.

do $$ begin
  create type job_type as enum (
    'offer_expiry','standby_roll','pending_expiry','stale_date_close',
    'day_of_reconfirm','safety_checkin','reconfirm_timeout','bulk_withdraw',
    'chat_purge','rating_window','deletion_process','analytics_relay','notify'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum ('pending','running','done','failed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  type job_type not null,
  run_after timestamptz not null default now(),
  dedup_key text,
  payload jsonb not null default '{}',
  status job_status not null default 'pending',
  attempts int not null default 0,
  last_error text,
  -- locked_at supports crash recovery (requeue_stuck_jobs); not in the C1 minimal
  -- DDL but a permitted runner-internal column (no consumer reads it).
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

-- C1 active-dedup: at most one pending|running job per (type, dedup_key).
create unique index if not exists jobs_dedup_active on jobs(type, dedup_key)
  where status in ('pending','running') and dedup_key is not null;
-- Runner hot query: pending jobs due now.
create index if not exists jobs_due_idx on jobs (run_after) where status = 'pending';
create index if not exists jobs_type_idx on jobs (type, status);

alter table jobs enable row level security;
-- No policies: jobs are written/read only by the service-role runner
-- (default-deny for anon/authenticated, same posture as rate_limits).
