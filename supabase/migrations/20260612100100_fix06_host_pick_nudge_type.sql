-- 20260612100100_fix06_host_pick_nudge_type.sql
-- Enum value only (must commit before first use — PG rule). The pushy host
-- nudge: hosts feel the queue waiting (founder, 2026-06-12).
alter type notification_type add value if not exists 'host_pick_nudge';
