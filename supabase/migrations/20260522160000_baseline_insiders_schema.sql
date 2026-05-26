-- BASELINE PARITY (not a new feature): the "insiders" program schema already exists in
-- production but was never captured in a local migration, so `supabase db reset` + `db:types`
-- could not reproduce it. This migration restores it faithfully from the production schema
-- (introspected read-only). Reproduces prod exactly: same columns/types/defaults/CHECKs/FKs/RLS.
-- Idempotent guards make it a safe no-op against environments that already have these objects
-- (e.g. production). No data is touched. Placed in the baseline band (pre-dates the S1 dating
-- work) because it is pre-existing baseline, not part of the After5 dating loop.

-- profiles: the three insider columns (read by app/insiders + admin code).
alter table profiles
  add column if not exists insider_role text,
  add column if not exists insider_points integer not null default 0,
  add column if not exists insider_approved_at timestamptz;

-- insider_applications: signup/application records (service-role-written via the apply route).
create table if not exists insider_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  first_name text not null,
  instagram text,
  motivation text not null,
  best_date_spot text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id),
  notes text
);
create index if not exists idx_insider_apps_status on insider_applications(status);

-- insider_tasks: assignable tasks for accepted insiders.
create table if not exists insider_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  assigned_to uuid references profiles(id),
  task_type text not null check (task_type in ('visit_venue','rate_date','improve_copy','business_outreach','take_photo')),
  title text not null,
  description text,
  venue_id uuid references places(id),
  itinerary_id uuid references itineraries(id),
  points_reward integer not null default 10,
  status text not null default 'open' check (status in ('open','assigned','submitted','approved','rejected')),
  submitted_at timestamptz,
  submission_notes text,
  submission_photo_url text,
  completed_at timestamptz
);
create index if not exists idx_insider_tasks_assignee on insider_tasks(assigned_to, status);

-- RLS to match production.
-- insider_applications: RLS enabled, NO policies (writes are service-role only via the apply route).
alter table insider_applications enable row level security;
-- insider_tasks: owner can read their tasks and update them while assigned/submitted.
alter table insider_tasks enable row level security;
do $$ begin
  create policy "Users can view their own tasks" on insider_tasks for select
    using (assigned_to = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users can update their own assigned tasks" on insider_tasks for update
    using (assigned_to = auth.uid() and status in ('assigned','submitted'));
exception when duplicate_object then null; end $$;
