-- 20260527124551_z_chat_lock_ready_5b_launch.sql
-- Z.1: amend chat_lock_ready body so the gate is meaningful at 5b launch.
-- At launch: returns true iff thread exists AND state='open'.
-- Phase 7 will redefine to ADD AND-conditions for rapport, without changing
-- the signature or A's call sites. See docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md §2.3.

create or replace function chat_lock_ready(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select state = 'open' from chat_threads where id = p_thread), false);
$$;

-- Re-apply revokes (CREATE OR REPLACE preserves them on Postgres ≥10, but make explicit for clarity)
revoke execute on function chat_lock_ready(uuid) from public, authenticated;
