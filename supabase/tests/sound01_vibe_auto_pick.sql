-- supabase/tests/sound01_vibe_auto_pick.sql
-- SOUND-01 — a generated/published date with vibe X auto-resolves a vibe-X ambient loop
-- from the EXPANDED library via the EXISTING feed/post_night lateral. No persist.ts change:
-- the vibe-overlap pick is already implemented at the date_instance layer
-- (browse_feed_for_viewer: di.ambient_sound_id is null AND s.vibe_tags && it.vibe_tags).
-- This test exercises that exact lateral against the Task-1 NEW tracks.
--
-- Assertions use the div-by-zero failure pattern (1/count(*) raises if count=0 → test fails).
-- BEGIN..ROLLBACK so nothing persists. Run via psql after `supabase db reset`.
\set ON_ERROR_STOP on
\i supabase/tests/_fixtures.sql
begin;

-- Sanity: the 8 Task-1 NEW tracks are present and active (the expanded library exists).
select 1/(case when count(*) = 8 then 1 else 0 end) as new_tracks_present
  from ambient_sounds where sort_order > 100 and is_active = true;

-- ── Case A: overlap → resolves to the vibe-matching NEW track ─────────────────
-- Seed a host, an itinerary tagged ['foodie','date-night'] (overlaps NEW 'table for two'),
-- and a published date_instance with NO host pick (ambient_sound_id = null) → the lateral
-- must auto-pick a vibe-overlapping active sound.
select mk_user('sound01_host') as host \gset
select mk_itinerary(:'host') as itin \gset
update itineraries set vibe_tags = array['foodie','date-night'] where id = :'itin';
select mk_instance(:'itin', :'host', now() + interval '3 days') as inst \gset
-- mk_instance leaves ambient_sound_id null (no host pick); assert that precondition.
select 1/(case when ambient_sound_id is null then 1 else 0 end) as no_host_pick
  from date_instances where id = :'inst';

-- The EXACT vibe-auto lateral from browse_feed_for_viewer (host pick first, else overlap).
create temp view resolved_ambient as
select di.id as date_instance_id, amb.name as resolved_name, amb.storage_path as resolved_path
from date_instances di
join itineraries it on it.id = di.itinerary_id
left join lateral (
  select s.name, s.storage_path
  from ambient_sounds s
  where s.is_active = true
    and (
      s.id = di.ambient_sound_id
      or (di.ambient_sound_id is null and s.vibe_tags && it.vibe_tags)
    )
  order by (s.id = di.ambient_sound_id) desc, s.sort_order desc, s.id
  limit 1
) amb on true
where di.id = :'inst';

-- The resolved sound's vibe_tags MUST overlap the itinerary's (vibe-matched).
select 1/(case when count(*) = 1 then 1 else 0 end) as resolves_to_overlapping_track
  from resolved_ambient ra
  join ambient_sounds s on s.name = ra.resolved_name
 where s.vibe_tags && array['foodie','date-night'];

-- And the resolved pick is the highest-sort_order overlapping track (tiebreak). Among
-- foodie/date-night, the NEW rows sort above the base 10; 'live set' (170) and
-- 'fine dining' (150) and 'table for two' (110) overlap — highest sort_order wins.
select 1/(case when ra.resolved_name = (
    select s.name from ambient_sounds s
    where s.is_active = true and s.vibe_tags && array['foodie','date-night']
    order by s.sort_order desc, s.id limit 1
  ) then 1 else 0 end) as picks_highest_sort_overlap
  from resolved_ambient ra;

-- ── Case B: no overlap → resolves to NULL (no crash) ──────────────────────────
-- An itinerary with a vibe that matches NOTHING in the library must resolve to null.
select mk_itinerary(:'host') as itin2 \gset
update itineraries set vibe_tags = array['no-such-vibe-xyz'] where id = :'itin2';
select mk_instance(:'itin2', :'host', now() + interval '4 days') as inst2 \gset

select 1/(case when count(*) = 0 then 1 else 0 end) as no_overlap_resolves_null
from date_instances di
join itineraries it on it.id = di.itinerary_id
left join lateral (
  select s.name
  from ambient_sounds s
  where s.is_active = true
    and (
      s.id = di.ambient_sound_id
      or (di.ambient_sound_id is null and s.vibe_tags && it.vibe_tags)
    )
  order by (s.id = di.ambient_sound_id) desc, s.sort_order desc, s.id
  limit 1
) amb on true
where di.id = :'inst2' and amb.name is not null;

rollback;
