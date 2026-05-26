-- supabase/migrations/20260525120000_p0_extensions_and_cities.sql
create extension if not exists btree_gist;
create extension if not exists postgis;

create table if not exists cities (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  country text not null default 'CA',
  region text,
  timezone text not null,
  centroid geography(Point, 4326),
  default_radius_km int not null default 40,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_cities_updated_at before update on cities
  for each row execute function set_updated_at();

alter table cities enable row level security;
do $$ begin
  create policy "cities_public_read" on cities for select using (is_active = true);
exception when duplicate_object then null; end $$;

insert into cities (slug, name, region, timezone, centroid, is_active)
values ('kelowna','Kelowna','BC','America/Vancouver',
        ST_SetSRID(ST_MakePoint(-119.4960, 49.8880),4326)::geography, true)
on conflict (slug) do nothing;
