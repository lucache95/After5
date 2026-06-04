-- 20260605120200_e11_post_night_targeting.sql
-- E11 (REQ-E11): extend the two creator-write RPCs.
--   (a) update_itinerary_stops  -> also set pay_setting + vibe_tags on the itinerary (D-10)
--   (b) post_night              -> also persist targeting onto the date_instances row (D-03b)
--
-- Both gain additive, DEFAULTed params so existing callers compile/behave unchanged.
-- Because Postgres keys a function by name + arg-type list, adding params creates a
-- NEW overload; the prior signature is dropped so exactly ONE live signature remains
-- per function (03-RESEARCH Pitfall 3 / 20260602120700 precedent) — this avoids the
-- PGRST203 "function is not unique" 500. Every re-emitted signature re-emits the
-- grant trio (revoke public + revoke anon + grant authenticated) because Supabase
-- auto-grants EXECUTE to anon on new public functions (Pitfall 2).

-- ───────────────────────────────────────────────────────────────────────────
-- (a) update_itinerary_stops: add pay_setting + vibe_tags setters
-- ───────────────────────────────────────────────────────────────────────────
-- The prior 5-arg signature (uuid, jsonb, text, text, text) becomes a stale
-- overload once we add the two new params; drop it so only the 7-arg lives.
drop function if exists update_itinerary_stops(uuid, jsonb, text, text, text);

create or replace function update_itinerary_stops(
  p_itinerary uuid,
  p_stops jsonb,
  p_title text default null,
  p_why_note text default null,
  p_cover_image_url text default null,
  p_pay_setting text default null,
  p_vibe_tags text[] default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_owns boolean; s jsonb;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='28000'; end if;

  select (user_id = v_actor) into v_owns from itineraries where id = p_itinerary;
  if not coalesce(v_owns, false) then
    raise exception 'not your itinerary' using errcode='42501';
  end if;

  if jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) = 0 then
    raise exception 'stops must be a non-empty array' using errcode='P0001';
  end if;
  if jsonb_array_length(p_stops) > 12 then
    raise exception 'too many stops (max 12)' using errcode='P0001';
  end if;
  for s in select * from jsonb_array_elements(p_stops) loop
    if coalesce(s->>'place_name','') = '' then
      raise exception 'each stop needs a place_name' using errcode='P0001';
    end if;
    if (s->>'start_time') is null then
      raise exception 'each stop needs a start_time' using errcode='P0001';
    end if;
    if coalesce((s->>'duration_min')::int, -1) < 0 then
      raise exception 'each stop needs a non-negative duration_min' using errcode='P0001';
    end if;
    if coalesce((s->>'estimated_cost_pp')::numeric, -1) < 0 then
      raise exception 'each stop needs a non-negative estimated_cost_pp' using errcode='P0001';
    end if;
  end loop;

  update itineraries
     set stops = p_stops,
         title = coalesce(p_title, title),
         why_note = coalesce(p_why_note, why_note),
         cover_image_url = coalesce(p_cover_image_url, cover_image_url),
         pay_setting = coalesce(p_pay_setting::payment_preference, pay_setting),
         vibe_tags = coalesce(p_vibe_tags, vibe_tags),
         total_cost_pp = (select coalesce(sum((e->>'estimated_cost_pp')::numeric),0) from jsonb_array_elements(p_stops) e),
         total_duration_min = (select coalesce(sum((e->>'duration_min')::int),0) from jsonb_array_elements(p_stops) e)
   where id = p_itinerary;
  return p_itinerary;
end $fn$;

revoke execute on function update_itinerary_stops(uuid, jsonb, text, text, text, text, text[]) from public;
revoke execute on function update_itinerary_stops(uuid, jsonb, text, text, text, text, text[]) from anon;
grant  execute on function update_itinerary_stops(uuid, jsonb, text, text, text, text, text[]) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- (b) post_night: add per-date targeting params, written to date_instances
-- ───────────────────────────────────────────────────────────────────────────
-- The prior 5-arg signature (uuid, timestamptz, uuid, int, uuid) becomes a stale
-- overload once we add the three targeting params; drop it so only the 8-arg lives
-- (every former caller binds unambiguously to the new signature via the defaults).
drop function if exists post_night(uuid, timestamptz, uuid, integer, uuid);

create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150,
  p_ambient_sound_id uuid default null,
  p_target_genders text[] default '{}',
  p_target_age_range int4range default null,
  p_search_radius_km numeric default null
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
  -- the fork; the canonical generated plan is never touched by later edits. Targeting
  -- is NOT copied here — it lives on date_instances (Pitfall 4), written below.
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
    (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status,
     ambient_sound_id, target_genders, target_age_range, search_radius_km)
  values
    (v_fork, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking',
     p_ambient_sound_id, coalesce(p_target_genders, '{}'), p_target_age_range, p_search_radius_km)
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function post_night(uuid, timestamptz, uuid, integer, uuid, text[], int4range, numeric) from public;
revoke execute on function post_night(uuid, timestamptz, uuid, integer, uuid, text[], int4range, numeric) from anon;
grant  execute on function post_night(uuid, timestamptz, uuid, integer, uuid, text[], int4range, numeric) to authenticated;
