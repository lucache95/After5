-- supabase/migrations/20260525120300_p0_date_instances.sql
do $$ begin
  create type date_match_status as enum ('none','seeking','matched','completed','cancelled');
exception when duplicate_object then null; end $$;

alter table itineraries
  add column if not exists city_id uuid references cities(id),
  add column if not exists is_evergreen boolean not null default true,
  add column if not exists match_status date_match_status not null default 'none',
  add column if not exists pay_setting payment_preference,
  add column if not exists ambient_sound_url text,
  add column if not exists why_note text,
  -- C7: the night object must carry vibe tags (the feed surfaces them). Without this column
  -- the canonical browse_feed CREATE VIEW would fail on `i.vibe_tags`. Required by C7/C11.3.
  add column if not exists vibe_tags text[] not null default '{}';

-- Immutable helper so the generated time_range column compiles.
-- PostgreSQL's timestamptz + interval operator is STABLE (not IMMUTABLE) due to timezone
-- context dependency, so the expression cannot appear directly in GENERATED ALWAYS AS.
-- This IMMUTABLE wrapper asserts the computation is purely deterministic, which it is
-- for our UTC-stored timestamptz values.
create or replace function tstzrange_from_start_duration(p_start timestamptz, p_mins int)
returns tstzrange language sql immutable strict as $$
  select tstzrange(p_start, p_start + make_interval(mins => p_mins))
$$;

-- A scheduled instance is a concrete, dated occurrence of an (evergreen) itinerary.
create table if not exists date_instances (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references itineraries(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade,
  city_id uuid not null references cities(id),
  venue_id uuid references places(id),
  starts_at timestamptz not null,
  duration_min int not null default 150 check (duration_min between 30 and 1440),
  time_range tstzrange generated always as
    (tstzrange_from_start_duration(starts_at, duration_min)) stored,
  status date_match_status not null default 'seeking',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists date_instances_creator_idx on date_instances(creator_id);
create index if not exists date_instances_city_status_idx on date_instances(city_id, status);
create index if not exists date_instances_range_gist on date_instances using gist (time_range);
create or replace trigger set_date_instances_updated_at before update on date_instances
  for each row execute function set_updated_at();

alter table date_instances enable row level security;
do $$ begin
  create policy "date_instances_creator_all" on date_instances for all
    using (creator_id = auth.uid()) with check (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
-- NOTE: browsers never select date_instances directly. The blind feed (browse_feed) and the
-- client-facing browse_feed_for_viewer() RPC are owned by S12 (C11.3), not P0. P0 ships only
-- this base table; no feed view here.
