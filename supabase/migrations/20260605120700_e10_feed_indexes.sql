-- 20260605120700_e10_feed_indexes.sql
-- E10 (REQ-E10, SC-4): supporting indexes for the new hard-filter predicates and the
-- reach_preview count. Uses create index if not exists (project convention).
--
-- reach_preview counts profiles by (dating_enabled, verification); a small partial
-- index on that pair keeps the count cheap as the profile table grows, even though the
-- MVP row count is small (RESEARCH A3).
create index if not exists profiles_reach_idx
  on profiles (dating_enabled, verification);

-- The hard host-gender filter compares cr.gender; the max-price filter compares
-- it.total_cost_pp. These btrees support those predicates without forcing a scan once
-- the candidate set grows. They are additive and cheap; EXPLAIN on the seeded local set
-- shows the planner already nested-loops the small feed, so these are pre-emptive only
-- (add-if-flagged per the plan; included here so the hard filters never regress at scale).
create index if not exists profiles_gender_idx
  on profiles (gender);

create index if not exists itineraries_total_cost_pp_idx
  on itineraries (total_cost_pp);
