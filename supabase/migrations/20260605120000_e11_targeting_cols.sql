-- 20260605120000_e11_targeting_cols.sql
-- E11 (REQ-E11): per-date targeting controls on date_instances. Additive only.
-- Targeting is per-DATE (the night), not per-PLAN (itineraries) — see 03-RESEARCH
-- Pitfall 4 / D-03b. The feed-side filtering/sort that CONSUMES these columns is
-- Phase 4 (E10); Phase 3 only adds the fields at creation time.
--
-- Safe DEFAULTs so existing date_instances rows stay valid with zero backfill
-- (Runtime State Inventory): empty target_genders = open to everyone; null
-- target_age_range = unbounded; null search_radius_km = city default radius.
-- search_radius_km is numeric (not int) to match Phase 4 REQ-E10's search_radius_km
-- type and avoid a later ALTER COLUMN. Idempotent (add column if not exists).
-- No RLS change: date_instances row policies (date_instances_creator_all +
-- offer-recipient SELECT) are row-level and already cover the new columns.
alter table date_instances
  add column if not exists target_genders text[] not null default '{}',
  add column if not exists target_age_range int4range,
  add column if not exists search_radius_km numeric;
