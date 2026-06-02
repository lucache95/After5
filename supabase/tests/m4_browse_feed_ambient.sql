-- m4_browse_feed_ambient.sql — the feed RPC returns the two new ambient columns
-- AND still upholds the blind contract (no host-identifying columns leak).
-- NOTE: bare unqualified name → ::regproc (regprocedure requires an arg-type list
-- in parens; browse_feed_for_viewer has a single overload so regproc is unambiguous).
\set ON_ERROR_STOP on
begin;
-- the return type now includes ambient_sound_path + ambient_sound_name
select 1/count(*) from (
  select unnest(string_to_array(pg_get_function_result('public.browse_feed_for_viewer'::regproc), ',')) as c
) t where c ilike '%ambient_sound_path%';
select 1/count(*) from (
  select unnest(string_to_array(pg_get_function_result('public.browse_feed_for_viewer'::regproc), ',')) as c
) t where c ilike '%ambient_sound_name%';
-- blind contract: the recreated feed RPC must NOT have re-introduced any
-- host-identifying column. 1/count(*) raises div-by-zero (test fails) if any appear.
select 1/(case when count(*) = 0 then 1 else 0 end) from (
  select unnest(string_to_array(pg_get_function_result('public.browse_feed_for_viewer'::regproc), ',')) as c
) t where c ~* '(itinerary_id|creator_id|venue_id)';
rollback;
