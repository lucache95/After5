-- 20260605120600_e10_reach_preview.sql
-- E10 (REQ-E10, D-01): reach_preview -- a lean DEFINER count of the profiles a
-- prospective night's targeting would reach, for the passive host pre-post nudge
-- ("~N people match this in <city>"). It returns ONLY an aggregate count(*)::int and
-- never any row identity, so it leaks nothing about individuals even though it reads
-- all profiles' gender/age/city (which a searcher could not read under RLS). This is
-- the same accepted DEFINER pattern as the match_* RPCs (the DEFINER-executable advisor
-- note is the app's established accepted finding, not a new one).
--
-- {everyone} normalization (Pitfall 1): {everyone} and {} both mean "no gender
-- restriction" -- identical to browse_feed_for_viewer's fit normalization, so an open
-- night counts everyone instead of undercounting to zero.
--
-- Grant trio (Pitfall 2): Supabase auto-grants EXECUTE to anon on new public functions,
-- so revoke public + revoke anon + grant authenticated.

drop function if exists reach_preview(text[], int4range, uuid, numeric);
create or replace function reach_preview(
  p_target_genders text[] default '{}',
  p_target_age_range int4range default null,
  p_city uuid default null,
  p_radius_km numeric default null
) returns integer language sql security definer set search_path = public, extensions as $fn$
  with c as (select centroid from cities where id = p_city)
  select count(*)::int
  from profiles pr
  left join c on true
  where pr.dating_enabled = true
    and pr.verification = 'verified'
    and pr.id <> auth.uid()
    -- gender: open targeting ({everyone}|{}) matches everyone
    and ( p_target_genders = '{}' or p_target_genders = array['everyone']
          or pr.gender = any(p_target_genders) )
    and ( p_target_age_range is null or pr.age <@ p_target_age_range )
    and ( p_radius_km is null or p_city is null
          or st_dwithin(
               (select centroid from cities where id = pr.primary_city_id),
               c.centroid, p_radius_km * 1000) );
$fn$;

revoke execute on function reach_preview(text[], int4range, uuid, numeric) from public;
revoke execute on function reach_preview(text[], int4range, uuid, numeric) from anon;
grant  execute on function reach_preview(text[], int4range, uuid, numeric) to authenticated;
