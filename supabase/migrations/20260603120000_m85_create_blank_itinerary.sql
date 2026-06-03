-- supabase/migrations/20260603120000_m85_create_blank_itinerary.sql
--
-- ⚠️ GATED — NOT YET APPLIED TO PROD. Task #85 (create entry paths, door 2).
-- Apply only via the reviewed batched prod-apply (security advisor after DDL).
--
-- create_blank_itinerary(): door 2 ("start from scratch") needs an owned itinerary
-- to open the §2A canvas on. This inserts one empty, private, owner-scoped row with a
-- single blank stop and returns its id. The canvas (update_itinerary_stops, owner RLS)
-- takes over from there; post_night forks it on post. Mirrors the secure-by-default
-- posture of update_itinerary_stops: security definer, auth required, anon revoked.
create or replace function create_blank_itinerary()
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_city uuid; v_id uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;

  -- The host's home city seeds city_id (nullable; the canvas/post step can still run
  -- without one). We do NOT gate on verification/dating here — that gate lives at
  -- post_night, so a host can draft a blank night before finishing verification.
  select primary_city_id into v_city from profiles where id = v_actor;

  -- inputs/stops are NOT NULL with no default; supply an empty inputs object and a
  -- single blank stop so the canvas opens on something editable, matching the web
  -- helper addBlankStop() (place_id '', 19:00, 60 min, $0).
  insert into itineraries (user_id, inputs, stops, is_public, title, city_id)
  values (
    v_actor,
    '{}'::jsonb,
    '[{"place_id":"","place_name":"","start_time":"19:00","duration_min":60,"estimated_cost_pp":0}]'::jsonb,
    false,
    null,
    v_city
  )
  returning id into v_id;

  return v_id;
end $fn$;

revoke execute on function create_blank_itinerary() from public;
revoke execute on function create_blank_itinerary() from anon;
grant execute on function create_blank_itinerary() to authenticated;
