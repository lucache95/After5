-- supabase/migrations/20260610090000_fix01_get_night_detail_stop_order.sql
-- FIX: get_night_detail scrambled stop order. The E20 widening re-aggregated
-- `it.stops` via jsonb_array_elements + jsonb_agg with NO ordinality and NO
-- ORDER BY, so Postgres was free to return elements in any order after the
-- LEFT JOIN to places — live repro: a stored 18:00→18:50→19:40 plan rendered
-- as 18:50, 19:40, 18:00 in the feed detail sheet ("6pm, 7pm, then 6pm").
-- Fix = WITH ORDINALITY + jsonb_agg(... ORDER BY ord): array order is now
-- guaranteed to match storage order (which the seed polish + editor save both
-- keep chronological).
--
-- CONTRACT UNCHANGED: byte-identical RETURNS TABLE signature; the E20 coord
-- widening, reservation_url scrub, and m5 blind contract all hold verbatim.
-- T-07-01/02/03: DEFINER + pinned search_path + privilege tail re-emitted.

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
    -- E20 widening + FIX: WITH ORDINALITY preserves the stored stop sequence
    -- through the places join; jsonb_agg ORDER BY ord re-emits it faithfully.
    case when jsonb_typeof(it.stops) = 'array' then coalesce((
      select jsonb_agg(
        (arr.s - 'reservation_url')
        || jsonb_build_object('lat', pj.lat, 'lng', pj.lng, 'place_slug', pj.slug)
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
