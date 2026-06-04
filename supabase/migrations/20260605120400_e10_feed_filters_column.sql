-- 20260605120400_e10_feed_filters_column.sql
-- E10 (REQ-E10): searcher feed-filter state, persisted on the profile.
--
-- A single additive jsonb column. The inclusive default is the empty object so a
-- brand-new searcher has NOTHING filtered (D-04, maximum liquidity). The whitelisted
-- keys (max_price, max_distance_km, host_genders, host_age_range, vibes, who_pays,
-- time_buckets) are unpacked inside browse_feed_for_viewer; absent/unknown keys mean
-- "no filter". Self read/write is already covered by the profiles_owner_all row policy
-- (capture_full_schema.sql), so NO new RLS policy is added here.
--
-- The shape guard keeps the RPC's jsonb unpacking safe (a non-object value would make
-- the ->> / ? operators misbehave). It is added NOT VALID so it never blocks the
-- migration on any pre-existing rows; new writes are checked.

alter table profiles
  add column if not exists feed_filters jsonb not null default '{}'::jsonb;

do $$
begin
  alter table profiles
    add constraint feed_filters_is_object
    check (jsonb_typeof(feed_filters) = 'object') not valid;
exception when duplicate_object then null;
end $$;
