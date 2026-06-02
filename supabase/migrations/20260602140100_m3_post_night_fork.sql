-- supabase/migrations/20260602140100_m3_post_night_fork.sql
-- M3 fork-on-post: copy the chosen itinerary into a private host-owned itinerary and
-- point the date_instance at the copy, so per-night edits (update_itinerary_stops)
-- never mutate the canonical generated plan or bleed to other nights. All existing
-- guards preserved verbatim from 20260602120300/120700 (5-arg signature, anon revoked
-- separately by 20260602120600 which still applies to this same signature).
create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150,
  p_ambient_sound_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_city uuid; v_ok boolean; v_id uuid; v_venue_ok boolean; v_fork uuid;
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

  if p_venue is not null then
    select (approval_status = 'live' and is_active) into v_venue_ok from places where id = p_venue;
    if not coalesce(v_venue_ok,false) then
      raise exception 'venue must be a reviewed (live) place to host a dating meetup' using errcode='P0001';
    end if;
  end if;

  if p_ambient_sound_id is not null then
    perform 1 from ambient_sounds where id = p_ambient_sound_id and is_active = true;
    if not found then
      raise exception 'ambient sound not found or inactive' using errcode='P0001';
    end if;
  end if;

  -- FORK: deep-copy the itinerary into a private host-owned row. The night references
  -- the fork; the canonical generated plan is never touched by later edits.
  insert into itineraries (
    user_id, template_id, inputs, stops, title, hook, why_it_works,
    total_cost_pp, total_duration_min, is_public, city_id, pay_setting,
    why_note, vibe_tags, cover_image_url, slug, intent
  )
  -- slug is forced NULL: itineraries_slug_key is a partial UNIQUE index, so copying a
  -- non-null slug would raise a duplicate-key error and break post_night. The fork is
  -- private (is_public=false), referenced by id via date_instance, so it needs no slug.
  select v_actor, template_id, inputs, stops, title, hook, why_it_works,
         total_cost_pp, total_duration_min, false, city_id, pay_setting,
         why_note, vibe_tags, cover_image_url, null, intent
  from itineraries where id = p_itinerary
  returning id into v_fork;

  insert into date_instances
    (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status, ambient_sound_id)
  values
    (v_fork, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking', p_ambient_sound_id)
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function post_night(uuid, timestamptz, uuid, integer, uuid) from public;
revoke execute on function post_night(uuid, timestamptz, uuid, integer, uuid) from anon;
grant execute on function post_night(uuid, timestamptz, uuid, integer, uuid) to authenticated;
