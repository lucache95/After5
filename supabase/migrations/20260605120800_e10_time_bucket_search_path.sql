-- 20260605120800_e10_time_bucket_search_path.sql
-- E10 security remediation: pin time_bucket_of's search_path.
--
-- The helper from 20260605120500 shipped without a SET search_path clause, which the
-- Supabase security advisor flags as function_search_path_mutable. The function is an
-- IMMUTABLE pure helper that only calls extract() on its argument (no table/object
-- lookups), so a mutable search_path is harmless in practice -- but the secure-by-default
-- convention (and the sibling browse_feed_for_viewer / reach_preview) pin it, so do the
-- same here to clear the advisory and keep the rule uniform.
create or replace function time_bucket_of(p_ts timestamptz)
returns text language sql immutable set search_path = public, extensions as $tb$
  select case
    when extract(isodow from p_ts) >= 5 then 'this_weekend'
    when extract(hour from p_ts) >= 17 then 'weeknights'
    else 'daytime'
  end;
$tb$;
