-- m4_browse_feed_ambient.sql — the feed RPC returns the two new ambient columns.
\set ON_ERROR_STOP on
begin;
-- the return type now includes ambient_sound_path + ambient_sound_name
select 1/count(*) from (
  select unnest(string_to_array(pg_get_function_result('public.browse_feed_for_viewer'::regprocedure), ',')) as c
) t where c ilike '%ambient_sound_path%';
select 1/count(*) from (
  select unnest(string_to_array(pg_get_function_result('public.browse_feed_for_viewer'::regprocedure), ',')) as c
) t where c ilike '%ambient_sound_name%';
rollback;
