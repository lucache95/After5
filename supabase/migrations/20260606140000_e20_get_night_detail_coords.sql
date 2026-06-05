-- supabase/migrations/20260606140000_e20_get_night_detail_coords.sql
-- E20 (REQ-E20 / Claude's-Discretion): widen each blind-safe night-detail stop with the
-- catalog venue's lat/lng/place_slug so the detail sheet can render a real Mapbox route
-- (E20) and post-lock surfaces can deep-link to /places/[slug] (E21) — without a
-- client-side `places` query that could correlate a stop to a host (T-07-01).
--
-- CONTRACT UNCHANGED: this is a CREATE OR REPLACE of get_night_detail(uuid). The
-- RETURNS TABLE signature is byte-identical to m5 (20260601210000) — `stops` stays a
-- single jsonb column; only the contents of each element widen. The m5 BLIND CONTRACT
-- holds verbatim: no host identity, hour-truncated time, reservation_url scrubbed.
--
-- DEGRADE (D-01): the join to `places` is a LEFT join on (s->>'place_id')::uuid. A stop
-- whose place_id is absent from the catalog (legacy / thin seed / freeform) yields
-- lat/lng/place_slug = null and the call still succeeds — no row error.
--
-- ORDERING: timestamp 20260606140000 sorts strictly after the latest applied migration
-- (20260606130200_e19_lock_rpc_producers), so a fresh `db reset` replays this last and
-- the m5 body cannot clobber the coord widening (Phase-6 ordering lesson).
--
-- T-07-01/02/03: coords merged INSIDE the DEFINER RPC; search_path pinned; the
-- revoke-public/revoke-anon/grant-authenticated tail is re-emitted verbatim.

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
    -- E20 widening: keep the reservation_url scrub (the only host-AUTHORED stop field),
    -- then merge the catalog venue's lat/lng/place_slug by the verified `place_id` key.
    -- A non-catalog stop left-joins to a null `pj` row → lat/lng/place_slug = null
    -- (graceful degrade, D-01). Guarded: legacy/thin rows may store a non-array jsonb.
    case when jsonb_typeof(it.stops) = 'array' then coalesce((
      select jsonb_agg(
        (s - 'reservation_url')
        || jsonb_build_object('lat', pj.lat, 'lng', pj.lng, 'place_slug', pj.slug)
      )
      from jsonb_array_elements(it.stops) as s
      left join places pj on pj.id = (s->>'place_id')::uuid
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

-- Re-emit the m5 privilege tail verbatim (CREATE OR REPLACE preserves grants, but we
-- re-assert for safety): authenticated-only, anon explicitly revoked (Supabase
-- auto-grants EXECUTE to anon on public functions).
revoke execute on function get_night_detail(uuid) from public;
revoke execute on function get_night_detail(uuid) from anon;
grant execute on function get_night_detail(uuid) to authenticated;
