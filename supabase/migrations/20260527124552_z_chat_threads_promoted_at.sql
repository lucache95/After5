-- 20260527124552_z_chat_threads_promoted_at.sql
-- Z.2: add promoted_at column + harden promote with state-filter to close
-- the partial-state race surfaced during Z spec self-review (R-Z4).
-- See docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md §2.4.

alter table chat_threads add column if not exists promoted_at timestamptz;

-- Backfill: any thread already in state='promoted' from local test runs gets coalesce(updated_at).
-- On prod this is a no-op (zero rows expected).
update chat_threads
   set promoted_at = updated_at
 where state = 'promoted' and promoted_at is null;

create or replace function promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  update chat_threads
     set lock_id = p_lock,
         state = 'promoted',
         promoted_at = coalesce(promoted_at, now()),
         updated_at = now()
   where offer_id = p_offer
     and state = 'open';                 -- Z.2 guard: refuses promote on closed/already-promoted
  get diagnostics v_n = row_count;
  if v_n = 0 then
    -- Distinguish missing thread vs wrong-state for caller's translation
    if not exists (select 1 from chat_threads where offer_id = p_offer) then
      raise exception 'promote_chat_thread_to_lock: no chat thread for offer %', p_offer;
    else
      raise exception 'promote_chat_thread_to_lock: thread for offer % is not open', p_offer;
    end if;
  end if;
end $fn$;

revoke execute on function promote_chat_thread_to_lock(uuid, uuid) from public, authenticated;
