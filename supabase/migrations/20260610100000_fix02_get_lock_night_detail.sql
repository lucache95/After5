-- supabase/migrations/20260610100000_fix02_get_lock_night_detail.sql
-- FIX-02: /matches/[lockId] could never show the locked night's plan.
-- get_night_detail(p_instance) is the BLIND PRE-LOCK feed path: its WHERE
-- requires di.status='seeking' AND di.starts_at > now() AND
-- di.creator_id <> auth.uid() — all three are wrong for a locked (or past)
-- night, so the lock detail's "the night" card always degraded to
-- "plan's being put together." for real matches.
--
-- get_lock_night_detail(p_lock) is the POST-LOCK twin: keyed by lock id,
-- gated ONLY on auth.uid() being one of the lock's two parties
-- (locks.creator_id / locks.matched_user_id — see 20260525120700_p0_locks),
-- with NO status / starts_at / moderation / creator-standing filters: a
-- locked, completed, cancelled, or past night must still return its plan.
--
-- Column shape is IDENTICAL to get_night_detail (fix01) for client parity:
-- same RETURNS TABLE, same WITH ORDINALITY + ORDER BY arr.ord stop ordering,
-- same reservation_url scrub + lat/lng/place_slug merge.
-- T-07: DEFINER (must read date_instances/itineraries across the pair's RLS),
-- pinned search_path, privilege tail (authenticated only).

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
    -- fix01 ordering kept verbatim: WITH ORDINALITY preserves the stored stop
    -- sequence through the places join; jsonb_agg ORDER BY ord re-emits it.
    case when jsonb_typeof(it.stops) = 'array' then coalesce((
      select jsonb_agg(
        (arr.s - 'reservation_url')
        || jsonb_build_object('lat', pj.lat, 'lng', pj.lng, 'place_slug', pj.slug)
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
