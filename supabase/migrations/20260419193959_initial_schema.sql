-- After5 — initial schema
-- Tables: places, templates, itineraries, feedback, pairings, user_preferences
-- All tables get RLS enabled by default; policies follow.
--
-- See PLAN.md Part 4A (place schema) and Part 7 (full schema) for rationale.

set check_function_bodies = off;

-- ─────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────

create type place_type as enum (
  'restaurant', 'cafe', 'winery', 'brewery', 'cocktail_bar',
  'dessert', 'ice_cream', 'bakery', 'hike', 'viewpoint', 'beach',
  'park', 'garden', 'activity', 'gallery', 'market', 'shop',
  'sunset_spot', 'walk'
);

create type effort_level as enum ('low', 'moderate', 'high');
create type energy_level as enum ('low', 'medium', 'high');
create type price_tier as enum ('$', '$$', '$$$');
create type weather_works_in as enum ('any', 'dry_only', 'indoor_friendly');
create type occasion as enum ('date', 'solo', 'friends');

-- ─────────────────────────────────────────────────────────────────────
-- PLACES — the moat
-- ─────────────────────────────────────────────────────────────────────

create table places (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  address       text,
  neighborhood  text not null,
  drive_cluster text not null,
  lat           decimal(9, 6),
  lng           decimal(9, 6),

  type          place_type not null,
  cuisine       text[] not null default '{}',

  vibe_tags     text[] not null default '{}',
  effort        effort_level not null default 'low',
  energy        energy_level not null default 'medium',
  pairing_tags  text[] not null default '{}',

  time_of_day        text[] not null default '{}',
  weather_dependent  boolean not null default false,
  weather_works_in   weather_works_in not null default 'any',
  seasonality        text[] not null default '{year_round}',
  typical_duration_min int not null default 60,
  opens              time,
  closes             time,
  closed_days        int[] not null default '{}',

  price_tier            price_tier not null default '$$',
  typical_per_person    decimal(8, 2),
  reservation_required  boolean not null default false,
  reservation_url       text,

  photo_url     text,
  notes         text,
  local_insight text,

  quality_score        decimal(4, 2) not null default 7.0,
  feedback_score       decimal(5, 2) not null default 0,
  total_appearances    int not null default 0,
  total_kept           int not null default 0,
  total_skipped        int not null default 0,
  total_loved          int not null default 0,

  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_places_active        on places (is_active);
create index idx_places_type_cluster  on places (type, drive_cluster) where is_active;
create index idx_places_vibe_tags     on places using gin (vibe_tags);
create index idx_places_pairing_tags  on places using gin (pairing_tags);

-- ─────────────────────────────────────────────────────────────────────
-- TEMPLATES — itinerary patterns
-- ─────────────────────────────────────────────────────────────────────

create table templates (
  id                text primary key,
  name              text not null,
  duration_min      int not null,
  suitable_for      occasion[] not null,
  vibe              text[] not null default '{}',
  slots             jsonb not null,
  geographic_rule   text,
  energy_curve      text,
  selection_weight  decimal(4, 2) not null default 1.0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- USERS (lightweight — Supabase Auth fills in auth.users)
-- ─────────────────────────────────────────────────────────────────────

create table user_preferences (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  vibe_weights         jsonb not null default '{}',
  type_weights         jsonb not null default '{}',
  cluster_weights      jsonb not null default '{}',
  price_tier_actual    price_tier,
  drive_tolerance_min  int,
  updated_at           timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- ITINERARIES — what we generated
-- ─────────────────────────────────────────────────────────────────────

create table itineraries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete set null,
  template_id         text references templates(id),
  inputs              jsonb not null,
  stops               jsonb not null,
  title               text,
  hook                text,
  why_it_works        text,
  total_cost_pp       decimal(8, 2),
  total_duration_min  int,
  is_public           boolean not null default false,
  loved_count         int not null default 0,
  generated_at        timestamptz not null default now()
);

create index idx_itineraries_user        on itineraries (user_id);
create index idx_itineraries_public      on itineraries (is_public) where is_public;
create index idx_itineraries_loved_count on itineraries (loved_count) where is_public;

-- ─────────────────────────────────────────────────────────────────────
-- FEEDBACK — the data that powers the loop
-- ─────────────────────────────────────────────────────────────────────

create table feedback (
  id                uuid primary key default gen_random_uuid(),
  itinerary_id      uuid not null references itineraries(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  loved_place_id    uuid references places(id),
  skipped_place_id  uuid references places(id),
  pacing_rating     text check (pacing_rating in ('rushed', 'perfect', 'slow')),
  free_text         text,
  created_at        timestamptz not null default now()
);

create index idx_feedback_itinerary on feedback (itinerary_id);

-- ─────────────────────────────────────────────────────────────────────
-- PAIRINGS — derived analytics
-- ─────────────────────────────────────────────────────────────────────

create table pairings (
  place_a       uuid not null references places(id) on delete cascade,
  place_b       uuid not null references places(id) on delete cascade,
  appearances   int not null default 0,
  loved         int not null default 0,
  skipped       int not null default 0,
  primary key (place_a, place_b)
);

-- ─────────────────────────────────────────────────────────────────────
-- TRIGGERS — keep updated_at fresh
-- ─────────────────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger places_updated_at
  before update on places
  for each row execute function set_updated_at();

create trigger user_preferences_updated_at
  before update on user_preferences
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- Default deny; explicit policies below.
-- ─────────────────────────────────────────────────────────────────────

alter table places            enable row level security;
alter table templates         enable row level security;
alter table itineraries       enable row level security;
alter table feedback          enable row level security;
alter table pairings          enable row level security;
alter table user_preferences  enable row level security;

-- Places: publicly readable when active. Writes restricted to service role.
create policy "places_public_read"
  on places for select
  using (is_active = true);

-- Templates: publicly readable when active.
create policy "templates_public_read"
  on templates for select
  using (is_active = true);

-- Itineraries:
--   Owners can read/write their own.
--   Anyone can read public itineraries.
create policy "itineraries_owner_all"
  on itineraries for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "itineraries_public_read"
  on itineraries for select
  using (is_public = true);

-- Feedback: users can write feedback for any itinerary; can only read their own.
create policy "feedback_self_read"
  on feedback for select
  using (user_id = auth.uid());

create policy "feedback_authenticated_insert"
  on feedback for insert
  with check (auth.uid() is not null);

-- Pairings: read-only for all (it's aggregate, no PII).
create policy "pairings_public_read"
  on pairings for select
  using (true);

-- User preferences: owner-only.
create policy "user_preferences_owner_all"
  on user_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
