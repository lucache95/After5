-- 20260527124550_s2_notification_type_5b_extend.sql
-- C1 contract amendment: add the 5 notification_type values 5b emits.
-- Additive only; safe to run alone. Apply BEFORE A's first migration (126000).
-- See docs/superpowers/plans/5b-prod-migration-rollout.md § PREREQ and
-- docs/superpowers/specs/2026-05-27-5b-A-happy-path-design.md §2.6.

alter type notification_type add value if not exists 'reciprocal_detected';
alter type notification_type add value if not exists 'offer_passed';
alter type notification_type add value if not exists 'offer_expired';
alter type notification_type add value if not exists 'lock_cancelled_frozen';
alter type notification_type add value if not exists 'lock_cancelled_rolled';
