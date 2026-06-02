-- m4_post_night_ambient.sql — post_night accepts and persists the ambient pick.
\set ON_ERROR_STOP on
begin;
-- 5-arg overload exists (the new signature)
select 1/count(*) from pg_proc
  where proname='post_night' and pronargs=5;
rollback;
