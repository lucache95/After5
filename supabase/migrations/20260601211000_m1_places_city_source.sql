-- M1: city-scope + provenance for places. Multi-city + on-the-fly cache.
-- Verified on prod ufufmcpnysvwtutpbian 2026-06-01 (pre-flight): places HAS
-- google_place_id, discovered_at, source_query, lat, lng, approval_status;
-- places does NOT have city_id or source (added here); there is NO unique
-- index on places.google_place_id on prod (added here — the on-the-fly upsert
-- onConflict:'google_place_id' depends on it).
alter table places
  add column if not exists city_id uuid references cities(id),
  add column if not exists source text not null default 'curated'
    check (source in ('curated','discovered','warmed'));

-- Backfill: every existing curated row belongs to Kelowna.
update places
   set city_id = (select id from cities where slug = 'kelowna')
 where city_id is null;

-- Required by the on-the-fly warmer's upsert (onConflict: 'google_place_id').
-- Idempotent: local already has this index; prod does not (pre-flight).
create unique index if not exists places_google_place_id_key
  on places (google_place_id) where google_place_id is not null;

create index if not exists idx_places_city_id on places (city_id);
create index if not exists idx_places_city_approval
  on places (city_id, approval_status) where is_active;
