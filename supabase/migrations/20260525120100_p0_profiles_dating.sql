-- supabase/migrations/20260525120100_p0_profiles_dating.sql
create type payment_preference as enum ('i_pay','they_pay','split');
create type verification_state as enum ('unverified','pending','verified','failed');

-- C3/C11.5 canonical account-state model: TWO orthogonal fields on profiles (not 3 tables).
--   standing       — moderation/reliability gate.   Owner of the WRITER ladder: S8 (P7/P8).
--   account_state  — lifecycle.                      Owner of the WRITER flows:  S10 (P9).
-- The ENUMS + COLUMNS are defined here in S1 (master-plan §6/§7) so can_enter_lock_flow
-- (S2) can read them before any consumer. Values are frozen by C3/C11.5 — do NOT add a 3rd
-- 'suspended' lifecycle value (suspension lives in standing='suspended', C11.5).
create type standing_state as enum
  ('good','warned','cooldown','throttled','reconfirm_required','locked_ban','suspended');
create type account_lifecycle as enum ('active','paused','deletion_pending','deleted');

alter table profiles
  add column if not exists primary_city_id uuid references cities(id),
  add column if not exists dating_enabled boolean not null default false,
  add column if not exists age int check (age is null or age >= 18),
  add column if not exists vibe_tags text[] not null default '{}',
  add column if not exists age_pref int4range,
  add column if not exists gender text,
  add column if not exists gender_preferences text[] not null default '{}',
  add column if not exists distance_pref_km int not null default 40,
  add column if not exists blurred_photo_url text,
  add column if not exists clear_photo_url text,
  add column if not exists reliability_score numeric(4,2),
  add column if not exists verification verification_state not null default 'unverified',
  -- C3/C11.5: the two account-state gate fields + the rollover freeze flag that
  -- can_enter_lock_flow(p_user) (S2) reads. Columns ship in S1; the ladders that WRITE
  -- standing (S8) and the lifecycle flows that write account_state (S10) come later.
  add column if not exists standing standing_state not null default 'good',
  add column if not exists account_state account_lifecycle not null default 'active',
  add column if not exists rollover_frozen boolean not null default false;

create table if not exists profiles_private (
  user_id uuid primary key references profiles(id) on delete cascade,
  full_name text,
  phone text,
  birthdate date,
  bio text,
  instagram_handle text,
  emergency_contact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_profiles_private_updated_at before update on profiles_private
  for each row execute function set_updated_at();

alter table profiles_private enable row level security;
do $$ begin
  create policy "profiles_private_owner_all" on profiles_private for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
