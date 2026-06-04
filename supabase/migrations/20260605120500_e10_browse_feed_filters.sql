-- 20260605120500_e10_browse_feed_filters.sql
-- E10 (REQ-E10): extend browse_feed_for_viewer with searcher feed_filters.
--
-- Layers onto the live m4 body (20260602120400_m4_browse_feed_ambient.sql) WITHOUT
-- touching the 5-param call signature, the 13 blind columns, the date_trunc('hour')
-- time-blinding, the baseline mutual-preference gates, or the keyset cursor. It adds:
--   * a 14th return column: fit boolean (computed, carries NO identity)
--   * HARD filters in WHERE (host gender / max price / max distance) that HIDE
--     non-matching nights, applied ONLY when the searcher set them (inclusive default)
--   * a SOFT score (vibe / who-pays / time-of-day) that only RE-SORTS via ORDER BY
--   * targeting-only fit: a night whose target_genders + target_age_range genuinely
--     include the viewer yields fit=true, normalizing the {everyone}/{} open case.
--
-- CRITICAL (D-03/SC-1): fit = date_fits_viewer ONLY. fit is a pure TARGETING signal
-- (does THIS night look for someone like the viewer). It MUST NOT be gated by the
-- soft score, or a brand-new searcher with feed_filters='{}' (every soft point = 0)
-- would never see the "looks for someone like you" pill on a perfectly targeted night.
-- The soft score is used in ORDER BY ONLY.
--
-- CURSOR DECISION (Open Question 1): the keyset stays on (starts_at, id). The composite
-- soft+targeting score is the LEADING ORDER BY key, so a genuine targeting match boosts
-- to the top and soft prefs refine ranking; the cursor predicate
-- (di.starts_at, di.id) > (p_after_starts, p_after_id) is UNCHANGED. This is best-effort
-- ranking within the fetched window (v1, spec section 9), not a global score keyset.
--
-- {everyone} normalization (Pitfall 1): open nights store the literal everyone-array
-- (or an empty array). Both mean "no gender restriction" and are normalized before the
-- viewer-gender comparison, here and in reach_preview, so open nights are never dropped.

-- IMMUTABLE helper: coarse time bucket of a start time, for the time-of-day soft filter.
-- weeknights = Mon..Thu 17:00..23:59; this_weekend = Fri..Sun; daytime = before 17:00
-- on a weekday. Kept deterministic (timestamp components only) so it is safe in ORDER BY.
create or replace function time_bucket_of(p_ts timestamptz)
returns text language sql immutable as $tb$
  select case
    when extract(isodow from p_ts) >= 5 then 'this_weekend'
    when extract(hour from p_ts) >= 17 then 'weeknights'
    else 'daytime'
  end;
$tb$;

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
  ambient_sound_path text, ambient_sound_name text,
  fit boolean
) language sql security definer set search_path = public, extensions as $fn$
  with me as (
    select gender, gender_preferences, age, age_pref, distance_pref_km,
           coalesce(p_point, (select centroid from cities c where c.id = pr.primary_city_id)) as pt,
           coalesce(pr.feed_filters, '{}'::jsonb) as ff
    from profiles pr where pr.id = p_viewer
  ),
  f as (  -- unpack the whitelisted feed_filters keys once; absent key = no filter (null)
    select
      (ff->>'max_price')::numeric                                                         as max_price,
      (ff->>'max_distance_km')::numeric                                                   as max_distance_km,
      case when ff ? 'host_genders' then array(select jsonb_array_elements_text(ff->'host_genders')) end as host_genders,
      case when ff ? 'vibes'        then array(select jsonb_array_elements_text(ff->'vibes'))        end as vibes,
      case when ff ? 'who_pays'     then array(select jsonb_array_elements_text(ff->'who_pays'))     end as who_pays,
      case when ff ? 'time_buckets' then array(select jsonb_array_elements_text(ff->'time_buckets')) end as time_buckets
    from me
  )
  select di.id, di.city_id, date_trunc('hour', di.starts_at) as time_window_start,
         it.pay_setting::text, it.vibe_tags, it.why_note,
         it.cover_image_url, it.title, pl.neighborhood,
         di.is_seed,
         st_distance(cc.centroid, me.pt) as distance_m,
         amb.storage_path, amb.name,
         -- fit: TARGETING-only. the night's target genuinely includes this viewer.
         -- open targeting ({everyone}|{}) is normalized to "no gender restriction".
         (
           ( di.target_genders = '{}' or di.target_genders = array['everyone']
             or me.gender = any(di.target_genders) )
           and ( di.target_age_range is null or me.age <@ di.target_age_range )
         ) as fit
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
    order by (s.id = di.ambient_sound_id) desc, s.sort_order desc, s.id
    limit 1
  ) amb on true
  cross join me
  cross join f
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
    -- E10 HARD filters: apply ONLY when the searcher set them (inclusive default).
    and (f.host_genders is null or cr.gender = any (f.host_genders))
    and (f.max_price is null or it.total_cost_pp <= f.max_price)
    and (f.max_distance_km is null or st_dwithin(cc.centroid, me.pt, f.max_distance_km * 1000))
    and (p_after_starts is null or (di.starts_at, di.id) > (p_after_starts, p_after_id))
  -- E10 SOFT score (re-sort only, never hide): targeting boost x4 + one point per
  -- matched soft filter (each absent filter contributes 0). Stable (starts_at,id) tail
  -- keeps the keyset cursor consistent (see CURSOR DECISION above).
  order by (
      ( (
          ( di.target_genders = '{}' or di.target_genders = array['everyone']
            or me.gender = any(di.target_genders) )
          and ( di.target_age_range is null or me.age <@ di.target_age_range )
        )::int * 4 )
      + (case when f.vibes        is null then 0 when it.vibe_tags && f.vibes                                  then 1 else 0 end)
      + (case when f.who_pays     is null then 0 when it.pay_setting::text = any(f.who_pays)                   then 1 else 0 end)
      + (case when f.time_buckets is null then 0 when time_bucket_of(di.starts_at) = any(f.time_buckets)       then 1 else 0 end)
    ) desc,
    di.starts_at asc, di.id asc
  limit greatest(1, least(coalesce(p_limit,20), 50));
$fn$;

revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from public;
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from anon;
grant  execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) to authenticated;
