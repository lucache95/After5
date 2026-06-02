-- supabase/migrations/20260602120000_m4_ambient_sounds.sql
-- Curated, royalty-free (Pixabay) ambient loop library. Admin/service-role writes only;
-- authenticated users may read active rows (the host picker + feed both need them).
create table if not exists ambient_sounds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vibe_tags text[] not null default '{}',
  storage_path text not null,            -- object path within the public 'ambient-sounds' bucket
  duration_sec int not null check (duration_sec between 5 and 120),
  attribution text,                      -- e.g. "Sound by <artist> on Pixabay"
  license text not null default 'Pixabay Content License',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ambient_sounds_active_idx on ambient_sounds(is_active, sort_order);
create index if not exists ambient_sounds_vibe_gin on ambient_sounds using gin (vibe_tags);
-- Stable natural key so the seed (Task 8) can upsert idempotently on name.
create unique index if not exists ambient_sounds_name_key on ambient_sounds(name);

alter table ambient_sounds enable row level security;
-- Authenticated read of active rows only. No write policy → only service_role (RLS-bypass) writes.
do $$ begin
  create policy "ambient_sounds_active_read" on ambient_sounds for select
    to authenticated using (is_active = true);
exception when duplicate_object then null; end $$;
