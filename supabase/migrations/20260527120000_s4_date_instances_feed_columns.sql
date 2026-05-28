-- supabase/migrations/20260527120000_s4_date_instances_feed_columns.sql
-- Minimal S4 columns the S5 feed depends on (Contract C11.8). moderation_status
-- default 'approved' because these first nights + concierge seeds are non-UGC.
do $$ begin
  create type moderation_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

alter table date_instances
  add column if not exists moderation_status moderation_status not null default 'approved',
  add column if not exists is_seed boolean not null default false;

create index if not exists date_instances_feed_idx
  on date_instances (status, starts_at)
  where status='seeking' and moderation_status='approved';
