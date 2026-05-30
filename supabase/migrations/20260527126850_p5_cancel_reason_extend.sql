-- 20260527126850_p5_cancel_reason_extend
-- History-reconciliation backfill: this migration is APPLIED ON PROD (version
-- 20260528163524) but had no local file, so `supabase db reset` diverged from
-- prod history. Recreated here verbatim from prod
-- (supabase_migrations.schema_migrations) so local reset reproduces prod order.
--
-- Every statement is idempotent (`add value if not exists`). On a local reset
-- these values are already present (also added by 20260527126900_p5_b_complete),
-- so this is a safe no-op locally while restoring the correct migration history.
-- The 'safety' value predates this migration (added with the enum in
-- 20260525120700_p0_locks).

alter type cancel_reason add value if not exists 'mutual';
alter type cancel_reason add value if not exists 'no_show';
alter type cancel_reason add value if not exists 'creator_pre_lock';
