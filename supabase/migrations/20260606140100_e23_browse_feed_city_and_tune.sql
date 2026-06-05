-- 20260606140100_e23_browse_feed_city_and_tune.sql
-- E22 + E23 (REQ-E22 / REQ-E23 / D-03): one feed-RPC re-CREATE rounds out relevance
-- and adds the human city label + a finer per-night distance.
--
-- Built on the CURRENT LIVE body (20260606120000_e15_browse_feed_host_hint.sql) — the
-- e15 host-hint widening, NOT the older e10 body. DROP+CREATE (not bare CREATE OR
-- REPLACE) because adding `city_name text` changes the RETURNS TABLE signature, which
-- makes Postgres RESET the function's privileges — so the revoke-public / revoke-anon /
-- grant-authenticated tail is re-emitted VERBATIM (Pitfall 1 / e15 "Pitfall 2 / T-05-03").
--
-- PRESERVED byte-for-byte from e15:
--   * the 5-param call signature + the 14 e10 cols + the 3 host-hint cols
--     (cr.blurred_photo_url, cr.first_name, cr.age),
--   * the date_trunc('hour') time-blinding,
--   * every baseline mutual-preference gate + every E10 HARD feed filter (e15:88-103),
--   * the `(di.starts_at asc, di.id asc)` KEYSET TAIL (Pitfall 3 / D-03 — only the score
--     expression changes; the cursor shape is unchanged so pagination stays stable),
--   * `language sql security definer set search_path = public, extensions`.
--
-- E23 ADDS:
--   * `city_name text` (= cities.name via the already-in-scope `cities cc` join, e15:72),
--   * finer distance: st_distance over the venue's coords when present (the existing
--     `left join places pl on pl.id = di.venue_id`, e15:73), else the city-centroid
--     fallback — `NightCard` still calls formatDistanceAway(distance_m) unchanged.
--
-- E22 TUNES the SOFT score (re-sort only, never hides — D-03):
--   * vibe overlap was a boolean 1/0 (`it.vibe_tags && f.vibes`); now it is the COUNT of
--     matched tags (cardinality of the intersect), so a richer vibe match ranks higher,
--   * + a light mutual-compat nudge (+1 when both sides' gender prefs align beyond the
--     hard gate). The targeting×4 term, who_pays + time_bucket terms, and the keyset tail
--     are all unchanged.

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
  fit boolean,
  -- E15 host hint (D-01): exactly these 3, projected from the cr creator join below.
  host_blurred_photo_url text, host_first_name text, host_age int,
  -- E23 (REQ-E23): the human city label (= cities.name), rendered on NightCard.
  city_name text
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
         -- E23 finer distance: prefer the venue's own coords when present, else the
         -- city centroid (e15:57 was always the centroid). pl is the existing places join.
         st_distance(
           coalesce(case when pl.lat is not null and pl.lng is not null
                         then st_point(pl.lng, pl.lat)::geography end, cc.centroid),
           me.pt
         ) as distance_m,
         amb.storage_path, amb.name,
         -- fit: TARGETING-only. the night's target genuinely includes this viewer.
         -- open targeting ({everyone}|{}) is normalized to "no gender restriction".
         (
           ( di.target_genders = '{}' or di.target_genders = array['everyone']
             or me.gender = any(di.target_genders) )
           and ( di.target_age_range is null or me.age <@ di.target_age_range )
         ) as fit,
         -- E15 host hint: limited disclosure from the creator profile (blurred path,
         -- first name, age only). The blurred PATH is signed app-side in feed/page.tsx.
         cr.blurred_photo_url, cr.first_name, cr.age,
         -- E23 city label: cities.name via the already-in-scope cc join (no new join).
         cc.name as city_name
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
  -- E22 SOFT score (re-sort only, never hide — D-03): targeting boost x4 + COUNT-weighted
  -- vibe overlap + who_pays/time_bucket terms + a light mutual-compat nudge. The
  -- (starts_at,id) keyset tail is UNCHANGED so the cursor stays stable (Pitfall 3).
  order by (
      ( (
          ( di.target_genders = '{}' or di.target_genders = array['everyone']
            or me.gender = any(di.target_genders) )
          and ( di.target_age_range is null or me.age <@ di.target_age_range )
        )::int * 4 )
      -- E22: vibe overlap weighted by COUNT of matched tags (was boolean 1/0). When
      -- f.vibes is null the intersect is empty → cardinality 0 → coalesce 0.
      + coalesce(cardinality(array(
          select unnest(it.vibe_tags) intersect select unnest(f.vibes))), 0)
      + (case when f.who_pays     is null then 0 when it.pay_setting::text = any(f.who_pays)                   then 1 else 0 end)
      + (case when f.time_buckets is null then 0 when time_bucket_of(di.starts_at) = any(f.time_buckets)       then 1 else 0 end)
      -- E22: light mutual-compat nudge — both sides' gender prefs align beyond the hard
      -- gate. The hard gates already filter; this only ranks a fuller mutual fit higher.
      + (case when me.gender = any(cr.gender_preferences) and cr.gender = any(me.gender_preferences) then 1 else 0 end)
    ) desc,
    di.starts_at asc, di.id asc
  limit greatest(1, least(coalesce(p_limit,20), 50));
$fn$;

revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from public;
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from anon;
grant  execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) to authenticated;
