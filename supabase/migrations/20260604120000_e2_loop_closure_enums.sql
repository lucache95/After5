-- 20260604120000_e2_loop_closure_enums.sql
-- Phase 02 (Loop Closure & Host Controls) Wave 1: the three additive enum values
-- that the Wave-2 E5/E6/E7 RPCs consume. Bare, idempotent ADD VALUE statements in
-- their OWN migration, sequenced AHEAD of any RPC that references them — Postgres
-- requires ALTER TYPE ... ADD VALUE to be committed before the value is used in a
-- later statement (matches the proven convention in
-- 20260603120000_gated_inbox_notification_types.sql).
--
--   date_match_status 'expired' (D-10) — the terminus for the past-dated unmatched
--     seeking sweep (E5 sweep_loop_terminus). DISTINCT from 'completed': an expired
--     night never matched, a completed night ran. Keeping them separate prevents
--     the loop from trapping a user in a false "completed" state.
--
--   notification_type 'night_cancelled' (D-09) — host cancelled a seeking night;
--     interested candidates are notified so they are never left waiting on a dead
--     night (E6 cancel_night).
--
--   notification_type 'night_changed' (D-09) — host made a material change (time or
--     venue) to a seeking night; interested candidates are notified (E7 update_night).
--
-- Additive + idempotent (each statement is guarded so a re-run is a no-op); no enum
-- value is dropped or renamed (destructive in Postgres). No new RLS surface is added.
--
-- GATED — LOCAL ONLY this phase. Prod apply is owner-approved and batched separately
-- (per the gated prod-apply convention); do NOT db:push this to prod from here.

alter type date_match_status add value if not exists 'expired';        -- D-10 (seeking-sweep terminus, distinct from 'completed')
alter type notification_type add value if not exists 'night_cancelled'; -- D-09 (host cancelled seeking night)
alter type notification_type add value if not exists 'night_changed';   -- D-09 (host materially changed seeking night)
