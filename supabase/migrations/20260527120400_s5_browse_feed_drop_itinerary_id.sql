-- supabase/migrations/20260527120400_s5_browse_feed_drop_itinerary_id.sql
-- Blind-contract fix: itinerary_id let clients join itineraries.user_id (world-
-- readable) to de-anonymize the creator. Drop it from the feed projection.
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
  cover_image_url text, title text, venue_neighborhood text, is_seed boolean, distance_m double precision
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
         st_distance(cc.centroid, me.pt) as distance_m
  from date_instances di
  join profiles cr on cr.id = di.creator_id
  join itineraries it on it.id = di.itinerary_id
  join cities cc on cc.id = di.city_id
  left join places pl on pl.id = di.venue_id
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
