-- supabase/migrations/20260525120500_p0_queue_entries.sql
do $$ begin
  create type queue_status as enum ('interested','shortlisted','offer_active','offer_passed','offer_expired','standby','locked');
exception when duplicate_object then null; end $$;

create table if not exists queue_entries (
  id uuid primary key default gen_random_uuid(),
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  candidate_id uuid not null references profiles(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  status queue_status not null default 'interested',
  rank int,                       -- creator-assigned; null until shortlisted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date_instance_id, candidate_id)
);
create index if not exists queue_entries_instance_rank_idx
  on queue_entries(date_instance_id, rank);
create or replace trigger set_queue_entries_updated_at before update on queue_entries
  for each row execute function set_updated_at();

alter table queue_entries enable row level security;
-- C7: `queue_entries.status` (and `rank`) are lifecycle columns. They are NOT directly
-- writable by RLS — only the C2 match_* RPCs (S6, SECURITY DEFINER) mutate them. RLS grants
-- SELECT only; there is NO insert/update/delete policy (default deny). This closes the hole
-- where a creator could forge `status='locked'` or shortlist a candidate who never swiped.
do $$ begin
  -- creator reads the queue for their own instances (to triage); no write policy.
  create policy "queue_creator_read" on queue_entries for select
    using (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- candidate sees only their own row (no other candidates).
  create policy "queue_candidate_read_own" on queue_entries for select
    using (candidate_id = auth.uid());
exception when duplicate_object then null; end $$;
