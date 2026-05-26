-- supabase/migrations/20260525120600_p0_offers.sql
do $$ begin
  create type offer_status as enum ('active','accepted','passed','expired');
exception when duplicate_object then null; end $$;

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  candidate_id uuid not null references profiles(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  status offer_status not null default 'active',
  expires_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
-- INVARIANT 1: at most one ACTIVE offer per date instance.
create unique index if not exists offers_one_active_per_instance
  on offers (date_instance_id) where status = 'active';
create index if not exists offers_candidate_idx on offers(candidate_id);

alter table offers enable row level security;
do $$ begin
  create policy "offers_party_read" on offers for select
    using (candidate_id = auth.uid() or creator_id = auth.uid());
exception when duplicate_object then null; end $$;
-- offers are created/resolved by SECURITY DEFINER functions (Phase 5); no direct write policy.
