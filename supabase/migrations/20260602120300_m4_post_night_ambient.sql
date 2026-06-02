-- supabase/migrations/20260602120300_m4_post_night_ambient.sql
-- Add an optional ambient pick to post_night. Validated against the active library;
-- NULL is allowed (host skipped → feed applies vibe-auto fallback at read time).
-- Built on the CURRENT main body (20260601211400_m1_post_night_curated_venue.sql):
-- M1's curated-venue check is preserved verbatim. This adds a 5-arg overload
-- (p_ambient_sound_id uuid default null) alongside the existing 4-arg signature;
-- the api-client always calls the 5-arg form.
create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150,
  p_ambient_sound_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_city uuid; v_ok boolean; v_id uuid; v_venue_ok boolean;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;
  if p_starts_at <= now() then raise exception 'starts_at must be in the future' using errcode='P0001'; end if;

  select (dating_enabled and verification='verified'), primary_city_id
    into v_ok, v_city from profiles where id = v_actor;
  if not coalesce(v_ok,false) then
    raise exception 'must be verified and dating-enabled to post a night' using errcode='P0001';
  end if;
  if v_city is null then raise exception 'no primary city set' using errcode='P0001'; end if;

  select true into v_ok from itineraries
    where id = p_itinerary and (user_id = v_actor or is_public = true) limit 1;
  if not coalesce(v_ok,false) then
    raise exception 'itinerary not found or not yours' using errcode='P0001';
  end if;

  -- M1: a pinned venue must be a curated, live place. Blocks auto/discovered.
  if p_venue is not null then
    select (approval_status = 'live' and is_active) into v_venue_ok from places where id = p_venue;
    if not coalesce(v_venue_ok,false) then
      raise exception 'venue must be a reviewed (live) place to host a dating meetup' using errcode='P0001';
    end if;
  end if;

  -- M4: validate the optional ambient pick against the active library.
  if p_ambient_sound_id is not null then
    perform 1 from ambient_sounds where id = p_ambient_sound_id and is_active = true;
    if not found then
      raise exception 'ambient sound not found or inactive' using errcode='P0001';
    end if;
  end if;

  insert into date_instances
    (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status, ambient_sound_id)
  values
    (p_itinerary, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking', p_ambient_sound_id)
  returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function post_night(uuid, timestamptz, uuid, int, uuid) from public;
grant execute on function post_night(uuid, timestamptz, uuid, int, uuid) to authenticated;
