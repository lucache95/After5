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

-- Dedupe accidental double-ingestions before the unique index. The discovery
-- script ingested 3 places twice on prod (6 rows, 3 redundant, 0 referenced as a
-- date_instances.venue_id — verified 2026-06-01). Keep one row per google_place_id
-- (prefer a curated 'live', active row; deterministic tiebreak by id) and drop the
-- extras. Idempotent + a NO-OP where there are no dupes (local/CI).
delete from places p using (
  select id, row_number() over (
    partition by google_place_id
    order by (approval_status = 'live') desc, is_active desc, id asc
  ) as rn
  from places
  where google_place_id is not null
) d
where p.id = d.id and d.rn > 1;

-- Required by the on-the-fly warmer's upsert (onConflict: 'google_place_id').
-- Idempotent: local already has this index; prod does not (pre-flight).
create unique index if not exists places_google_place_id_key
  on places (google_place_id) where google_place_id is not null;

create index if not exists idx_places_city_id on places (city_id);
create index if not exists idx_places_city_approval
  on places (city_id, approval_status) where is_active;
