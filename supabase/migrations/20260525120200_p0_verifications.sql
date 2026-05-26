-- supabase/migrations/20260525120200_p0_verifications.sql
create table if not exists verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('phone','selfie','age')),
  state verification_state not null default 'pending',
  provider text,
  provider_ref text,
  failure_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verifications_user_idx on verifications(user_id);
create or replace trigger set_verifications_updated_at before update on verifications
  for each row execute function set_updated_at();

alter table verifications enable row level security;
do $$ begin
  create policy "verifications_owner_read" on verifications for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- writes are service-role only (verification vendor webhook); no insert/update policy.
