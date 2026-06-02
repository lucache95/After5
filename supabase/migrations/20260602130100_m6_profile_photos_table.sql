-- 20260602130100_m6_profile_photos_table.sql
-- M6: ordered multi-photo gallery. One row per photo; storage objects live at
-- profile-photos/<uid>/<id>.jpg (clear) and <uid>/<id>_blurred.jpg (blind feed).
-- profiles.clear_photo_url / blurred_photo_url remain a denormalized mirror of the
-- PRIMARY photo so existing feed/queue/reveal selects keep working unchanged.
create table if not exists profile_photos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  clear_path   text not null,            -- '<uid>/<id>.jpg'
  blurred_path text,                     -- '<uid>/<id>_blurred.jpg' (set by generate-blur)
  sort_order   int not null default 0,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists profile_photos_user_order_idx
  on profile_photos (user_id, sort_order);
-- At most one primary per user.
create unique index if not exists profile_photos_one_primary_idx
  on profile_photos (user_id) where is_primary;

alter table profile_photos enable row level security;

-- Owner full CRUD on own rows (never using(true) on writes).
do $$ begin
  create policy profile_photos_owner_all on profile_photos for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Reveal read: a counterparty in an active offer / lock may SELECT the gallery rows
-- (clear paths) of someone they're revealed to. Mirrors profiles_select_revealed.
do $$ begin
  create policy profile_photos_revealed_read on profile_photos for select
    to authenticated
    using (user_id = auth.uid() or match_reveal_allowed_pair(auth.uid(), user_id));
exception when duplicate_object then null; end $$;
