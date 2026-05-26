-- supabase/migrations/20260525120700_p0_locks.sql
do $$ begin
  create type lock_status as enum ('active','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;
-- cancel_reason: canonical taxonomy is owned by C2 (the match transition API). It is
-- declared here because the locks table references it, but its VALUES are fixed by C2
-- and MUST NOT be invented locally. See C2. Includes 'account_closed' (S10 lifecycle uses it).
do $$ begin
  create type cancel_reason as enum
    ('schedule_conflict','venue_issue','changed_mind','account_closed','safety','misconduct','other');
exception when duplicate_object then null; end $$;

create table if not exists locks (
  id uuid primary key default gen_random_uuid(),
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  matched_user_id uuid not null references profiles(id) on delete cascade,
  status lock_status not null default 'active',
  locked_at timestamptz not null default now(),
  cancelled_by uuid references profiles(id),
  cancel_reason cancel_reason,
  -- Required by the set_locks_updated_at trigger below: set_updated_at() assigns
  -- new.updated_at, so this column MUST exist or every UPDATE to locks (status change
  -- on completion/cancellation in S6/S8, and the S1 audit_log test) throws
  -- "record new has no field updated_at". Matches the updated_at convention on all
  -- other loop tables.
  updated_at timestamptz not null default now(),
  -- a given night locks to exactly one pair. NOTE (S6): this is a hard unique, so a night
  -- whose lock is later cancelled cannot form a NEW lock row. S6's match_cancel_lock must
  -- decide whether a benign cancellation re-opens the night (transition date_instance back
  -- to 'seeking' for a fresh lock) or closes it permanently. Acceptable for the S1 spine.
  unique (date_instance_id),
  -- A creator cannot lock a date with themselves. Without this, a self-lock makes the
  -- sync trigger insert two lock_participants rows with the same (lock_id,user_id) and
  -- fails on the PK — surfacing a confusing unique_violation instead of a clear domain error.
  check (creator_id <> matched_user_id)
);
create or replace trigger set_locks_updated_at before update on locks
  for each row execute function set_updated_at();

-- One participant row per (user, lock) carries the instance's time_range so a GiST
-- exclusion constraint can forbid a user holding two ACTIVE overlapping commitments.
create table if not exists lock_participants (
  lock_id uuid not null references locks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  time_range tstzrange not null,
  active boolean not null default true,
  primary key (lock_id, user_id),
  exclude using gist (user_id with =, time_range with &&) where (active)
);

-- Keep lock_participants in sync with locks via trigger (both creator + matched user).
create or replace function sync_lock_participants() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare rng tstzrange;
begin
  select time_range into rng from date_instances where id = new.date_instance_id;
  -- Defensive: the FK guarantees the instance exists and time_range is generated from
  -- NOT NULL columns, so this should never trip — but a clear error here beats a confusing
  -- NOT NULL violation on lock_participants if the instance is ever missing/orphaned.
  if rng is null then
    raise exception 'sync_lock_participants: no time_range for date_instance %', new.date_instance_id;
  end if;
  if (tg_op = 'INSERT') then
    insert into lock_participants(lock_id,user_id,time_range,active)
    values (new.id,new.creator_id,rng,new.status='active'),
           (new.id,new.matched_user_id,rng,new.status='active');
  elsif (tg_op = 'UPDATE') then
    update lock_participants set active = (new.status='active') where lock_id = new.id;
  end if;
  return new;
end $fn$;
create or replace trigger locks_sync_participants after insert or update on locks
  for each row execute function sync_lock_participants();
-- C10: internal trigger helper — not a callable RPC. Revoking execute is defense-in-depth
-- (it returns trigger so it can't be invoked directly anyway; triggers still fire normally).
revoke execute on function sync_lock_participants() from public, authenticated, anon;

alter table locks enable row level security;
alter table lock_participants enable row level security;
do $$ begin
  create policy "locks_party_read" on locks for select
    using (creator_id = auth.uid() or matched_user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "lock_participants_self_read" on lock_participants for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
