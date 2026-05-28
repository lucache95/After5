-- supabase/migrations/20260527120200_s5_post_night.sql
-- A verified, dating-enabled user turns an owned-or-public itinerary into a
-- seeking night. status is RPC-only (C7); direct INSERT is still RLS-gated to
-- the creator as defense-in-depth.
create or replace function post_night(
  p_itinerary uuid, p_starts_at timestamptz,
  p_venue uuid default null, p_duration_min int default 150
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_city uuid; v_ok boolean; v_id uuid;
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

  insert into date_instances (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status)
  values (p_itinerary, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking')
  returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function post_night(uuid, timestamptz, uuid, int) from public;
grant execute on function post_night(uuid, timestamptz, uuid, int) to authenticated;

do $$ begin
  create policy "date_instances_owner_insert" on date_instances for insert
    to authenticated with check (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "date_instances_owner_select" on date_instances for select
    to authenticated using (creator_id = auth.uid());
exception when duplicate_object then null; end $$;
