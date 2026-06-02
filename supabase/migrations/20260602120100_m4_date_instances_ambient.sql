-- supabase/migrations/20260602120100_m4_date_instances_ambient.sql
-- Optional per-date ambient pick. NULL = host skipped → feed RPC applies a vibe-auto fallback.
alter table date_instances
  add column if not exists ambient_sound_id uuid references ambient_sounds(id) on delete set null;
