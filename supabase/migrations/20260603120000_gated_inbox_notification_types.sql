-- 20260603120000_gated_inbox_notification_types.sql
-- GATED — DO NOT APPLY TO PROD until the dispatch sites exist (spec §2 / D5).
-- Unified inbox (#84) phase 2: two additive notification_type values that back the
-- two headline grouped/single activity rows the inbox calls for.
--   interest_received  — a searcher swiped interested on a host's posted night.
--                        Payload carries date_instance_id (the group key); the
--                        swiper count is DERIVED at read time, not stored.
--   identity_revealed  — a match crossed the reveal threshold and a counterpart's
--                        Tier-3 profile unlocked. Payload carries lock_id/offer_id.
--
-- Additive + idempotent (matches the established convention in
-- 20260527124550_s2_notification_type_5b_extend.sql). Safe to run alone.
--
-- GATING RATIONALE (spec D5): these rows only populate once the swipe-interest RPC
-- and the reveal path call dispatch_notification for them. Until those dispatch
-- sites land, applying this enum change is harmless but pointless — and the inbox
-- handles the absence gracefully (a type that is never dispatched simply never
-- appears, no regression). Apply this migration in the SAME batch as the dispatch
-- wiring, then run the Supabase security advisor (no new RLS surface is added here,
-- but the convention is: advisor after every DDL).

alter type notification_type add value if not exists 'interest_received';
alter type notification_type add value if not exists 'identity_revealed';
