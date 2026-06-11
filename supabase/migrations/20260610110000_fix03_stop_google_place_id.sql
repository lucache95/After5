-- supabase/migrations/20260610110000_fix03_stop_google_place_id.sql
-- Map links should open the venue's ACTUAL Google place page, not a coordinate
-- search (founder/codex 2026-06-10). All 179 active Kelowna places carry
-- google_place_id, so the detail RPCs now merge it into each stop alongside
-- lat/lng/place_slug; the UI builds query_place_id links with the existing
-- coordinate/name fallbacks for stops that miss the catalog join.
--
-- ADDITIVE jsonb key on both detail RPCs — RETURNS TABLE shapes unchanged;
-- fix01 stop ordering (WITH ORDINALITY + ORDER BY arr.ord) and the
-- reservation_url scrub kept verbatim. T-07: DEFINER, pinned search_path,
-- privilege tails re-emitted.

create or replace function get_night_detail(p_instance uuid)
returns table (
  date_instance_id uuid,
  time_window_start timestamptz,
  pay_setting text,
  vibe_tags text[],
  why_note text,
  hook text,
  why_it_works text,
  cover_image_url text,
  title text,
  venue_neighborhood text,
  is_seed boolean,
  total_cost_pp numeric,
  total_duration_min int,
  stops jsonb
) language sql security definer set search_path = public, extensions as $fn$
  select
    di.id,
    date_trunc('hour', di.starts_at) as time_window_start,
    it.pay_setting::text,
    it.vibe_tags,
    it.why_note,
    it.hook,
    it.why_it_works,
    it.cover_image_url,
    it.title,
    pl.neighborhood,
    di.is_seed,
    it.total_cost_pp,
    it.total_duration_min,
    case when jsonb_typeof(it.stops) = 'array' then coalesce((
      select jsonb_agg(
        (arr.s - 'reservation_url')
        || jsonb_build_object('lat', pj.lat, 'lng', pj.lng, 'place_slug', pj.slug, 'google_place_id', pj.google_place_id)
        order by arr.ord
      )
      from jsonb_array_elements(it.stops) with ordinality as arr(s, ord)
      left join places pj on pj.id = (arr.s->>'place_id')::uuid
    ), '[]'::jsonb) else '[]'::jsonb end as stops
  from date_instances di
  join profiles cr on cr.id = di.creator_id
  join itineraries it on it.id = di.itinerary_id
  left join places pl on pl.id = di.venue_id
  where di.id = p_instance
    and di.status = 'seeking'
    and di.starts_at > now()
    and di.moderation_status = 'approved'
    and cr.account_state = 'active'
    and cr.standing not in ('suspended','locked_ban')
    and cr.verification = 'verified'
    and cr.dating_enabled = true
    and di.creator_id <> auth.uid();
$fn$;

revoke execute on function get_night_detail(uuid) from public;
revoke execute on function get_night_detail(uuid) from anon;
grant execute on function get_night_detail(uuid) to authenticated;

create or replace function get_lock_night_detail(p_lock uuid)
returns table (
  date_instance_id uuid,
  time_window_start timestamptz,
  pay_setting text,
  vibe_tags text[],
  why_note text,
  hook text,
  why_it_works text,
  cover_image_url text,
  title text,
  venue_neighborhood text,
  is_seed boolean,
  total_cost_pp numeric,
  total_duration_min int,
  stops jsonb
) language sql security definer set search_path = public, extensions as $fn$
  select
    di.id,
    date_trunc('hour', di.starts_at) as time_window_start,
    it.pay_setting::text,
    it.vibe_tags,
    it.why_note,
    it.hook,
    it.why_it_works,
    it.cover_image_url,
    it.title,
    pl.neighborhood,
    di.is_seed,
    it.total_cost_pp,
    it.total_duration_min,
    case when jsonb_typeof(it.stops) = 'array' then coalesce((
      select jsonb_agg(
        (arr.s - 'reservation_url')
        || jsonb_build_object('lat', pj.lat, 'lng', pj.lng, 'place_slug', pj.slug, 'google_place_id', pj.google_place_id)
        order by arr.ord
      )
      from jsonb_array_elements(it.stops) with ordinality as arr(s, ord)
      left join places pj on pj.id = (arr.s->>'place_id')::uuid
    ), '[]'::jsonb) else '[]'::jsonb end as stops
  from locks l
  join date_instances di on di.id = l.date_instance_id
  join itineraries it on it.id = di.itinerary_id
  left join places pl on pl.id = di.venue_id
  where l.id = p_lock
    and auth.uid() in (l.creator_id, l.matched_user_id);
$fn$;

revoke execute on function get_lock_night_detail(uuid) from public;
revoke execute on function get_lock_night_detail(uuid) from anon;
grant execute on function get_lock_night_detail(uuid) to authenticated;
