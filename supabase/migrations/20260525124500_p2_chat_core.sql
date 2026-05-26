-- supabase/migrations/20260525124500_p2_chat_core.sql
-- Chat-core slice (INTEGRATION-CONTRACT C11.7). Ships at band 124500 (before P5
-- 126xxx) so P5's tests can call open_chat_thread/chat_lock_ready/promote/close.
-- P6's rich messaging/retention/moderation lands later in S7 (band 127xxx) on top
-- of this table. P5 calls these per C2. Reveal predicate is match_reveal_allowed
-- (C2/C9) — chat-core does NOT define a competing reveal. Legal-hold posture (C9):
-- thread survives profile delete (tombstone), carries revoked_at; held threads
-- exempt from purge (P9/S10).

create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(id) on delete cascade,
  lock_id uuid references locks(id) on delete set null,
  state text not null default 'open' check (state in ('open','promoted','closed')),
  both_ready boolean not null default false,   -- rapport gate (S7 sets via real messaging)
  legal_hold boolean not null default false,   -- P9/S10 sets; exempts from purge
  revoked_at timestamptz,                      -- C9 tombstone marker
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chat_threads_offer_uniq on chat_threads (offer_id);
create index if not exists chat_threads_lock_idx on chat_threads (lock_id);

do $$ begin
  create trigger set_chat_threads_updated_at before update on chat_threads
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

alter table chat_threads enable row level security;
-- Participant-read RLS is added by P6/S7 (it joins offer→participants). For S2,
-- service-role only (P5 RPCs are SECURITY DEFINER). No anon/authenticated writes.

-- open_chat_thread(p_offer): called by match_make_offer (C2). Idempotent.
create or replace function open_chat_thread(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into chat_threads (offer_id) values (p_offer)
  on conflict (offer_id) do update set updated_at = now()
  returning id into v_id;
  return v_id;
end $fn$;

-- chat_lock_ready(p_thread): the lock gate (C2). True iff both parties have built
-- enough rapport (S7 messaging flips both_ready) OR a mutual override applies.
create or replace function chat_lock_ready(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select both_ready from chat_threads where id = p_thread), false);
$$;

-- promote_chat_thread_to_lock(p_offer, p_lock): on accept (C2).
create or replace function promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update chat_threads set lock_id = p_lock, state = 'promoted', updated_at = now()
   where offer_id = p_offer;
end $fn$;

-- close_chat_thread(p_offer): on pass/expire (C2). Held threads are NOT purged
-- (P9/S10 honors legal_hold); closing just marks state.
create or replace function close_chat_thread(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update chat_threads set state = 'closed', revoked_at = coalesce(revoked_at, now()), updated_at = now()
   where offer_id = p_offer and not legal_hold;
end $fn$;

revoke execute on function open_chat_thread(uuid) from public, authenticated;
revoke execute on function chat_lock_ready(uuid) from public, authenticated;
revoke execute on function promote_chat_thread_to_lock(uuid, uuid) from public, authenticated;
revoke execute on function close_chat_thread(uuid) from public, authenticated;
