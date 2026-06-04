-- m4_post_night_ambient.sql — post_night accepts and persists the ambient pick.
\set ON_ERROR_STOP on
begin;
-- post_night exists as exactly one live signature; the ambient pick (p_ambient_sound_id)
-- is param 5 of that signature. E11 (20260605120200) extended it to 8 args
-- (+target_genders/+target_age_range/+search_radius_km) and dropped the prior 5-arg
-- overload, so assert the single 8-arg signature carries the ambient param.
select 1/count(*) from pg_proc
  where proname='post_night' and pronargs=8;
rollback;
