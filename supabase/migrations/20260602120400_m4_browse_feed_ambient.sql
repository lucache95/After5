-- supabase/migrations/20260602120400_m4_browse_feed_ambient.sql
-- Add resolved ambient pick to the blind feed: host's choice, else a vibe-auto fallback
-- (highest sort_order active sound whose vibe_tags overlap the night's), else NULL.
-- Returns the relative storage path; the client prefixes the public bucket base URL.
--
-- Based on the LIVE body (20260527120400_s5_browse_feed_drop_itinerary_id.sql) which
-- DROPPED itinerary_id from the projection (blind-contract fix). itinerary_id stays
-- OUT of the return; only the two ambient columns are layered on top. The blind WHERE
-- filters are preserved verbatim. Drop+recreate keeps the return type clean.
drop function if exists browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int);
create or replace function browse_feed_for_viewer(
  p_viewer uuid default auth.uid(),
  p_point geography default null,
  p_after_starts timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 20
) returns table (
  date_instance_id uuid, city_id uuid, time_window_start timestamptz,
  pay_setting text, vibe_tags text[], why_note text,
  cover_image_url text, title text, venue_neighborhood text, is_seed boolean, distance_m double precision,
  ambient_sound_path text, ambient_sound_name text
) language sql security definer set search_path = public, extensions as $fn$
  with me as (
    select gender, gender_preferences, age, age_pref, distance_pref_km,
           coalesce(p_point, (select centroid from cities c where c.id = pr.primary_city_id)) as pt
    from profiles pr where pr.id = p_viewer
  )
  select di.id, di.city_id, date_trunc('hour', di.starts_at) as time_window_start,
         it.pay_setting::text, it.vibe_tags, it.why_note,
         it.cover_image_url, it.title, pl.neighborhood,
         di.is_seed,
         st_distance(cc.centroid, me.pt) as distance_m,
         amb.storage_path, amb.name
  from date_instances di
  join profiles cr on cr.id = di.creator_id
  join itineraries it on it.id = di.itinerary_id
  join cities cc on cc.id = di.city_id
  left join places pl on pl.id = di.venue_id
  -- resolved ambient: host pick first, else vibe-auto fallback, else nothing.
  left join lateral (
    select s.storage_path, s.name
    from ambient_sounds s
    where s.is_active = true
      and (
        s.id = di.ambient_sound_id
        or (di.ambient_sound_id is null and s.vibe_tags && it.vibe_tags)
      )
    -- prefer the explicit pick (id match), then highest sort_order.
    order by (s.id = di.ambient_sound_id) desc, s.sort_order desc, s.id
    limit 1
  ) amb on true
  cross join me
  where di.status = 'seeking'
    and di.starts_at > now()
    and di.moderation_status = 'approved'
    and cr.account_state = 'active' and cr.standing not in ('suspended','locked_ban')
    and cr.verification = 'verified' and cr.dating_enabled = true
    and di.creator_id <> p_viewer
    and not exists (select 1 from swipes s where s.swiper_id = p_viewer and s.date_instance_id = di.id)
    and cr.gender = any (me.gender_preferences)
    and me.gender = any (cr.gender_preferences)
    and me.age <@ cr.age_pref and cr.age <@ me.age_pref
    and st_dwithin(cc.centroid, me.pt, least(me.distance_pref_km, cr.distance_pref_km) * 1000)
    and (p_after_starts is null or (di.starts_at, di.id) > (p_after_starts, p_after_id))
  order by di.starts_at asc, di.id asc
  limit greatest(1, least(coalesce(p_limit,20), 50));
$fn$;
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from public;
grant execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) to authenticated;
