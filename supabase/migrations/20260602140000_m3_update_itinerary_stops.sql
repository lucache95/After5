-- supabase/migrations/20260602140000_m3_update_itinerary_stops.sql
-- M3: the single validated write path for host itinerary edits (stops + title/why/cover).
-- Owners already hold UPDATE RLS (itineraries_owner_all); this RPC adds shape validation
-- + a clamp in one place and is the only thing the edit UI calls.
create or replace function update_itinerary_stops(
  p_itinerary uuid,
  p_stops jsonb,
  p_title text default null,
  p_why_note text default null,
  p_cover_image_url text default null
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
         total_cost_pp = (select coalesce(sum((e->>'estimated_cost_pp')::numeric),0) from jsonb_array_elements(p_stops) e),
         total_duration_min = (select coalesce(sum((e->>'duration_min')::int),0) from jsonb_array_elements(p_stops) e)
   where id = p_itinerary;
  return p_itinerary;
end $fn$;

revoke execute on function update_itinerary_stops(uuid, jsonb, text, text, text) from public;
revoke execute on function update_itinerary_stops(uuid, jsonb, text, text, text) from anon;
grant execute on function update_itinerary_stops(uuid, jsonb, text, text, text) to authenticated;
