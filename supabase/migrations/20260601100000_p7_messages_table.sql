-- supabase/migrations/20260601100000_p7_messages_table.sql
-- Phase 7 message store. One row per chat message. Belongs to a chat_thread
-- (which is keyed to an offer). RLS enabled here, ZERO policies in this file --
-- policies land in 100100 (same default-deny posture chat_threads ships with).
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references chat_threads(id) on delete cascade,
  sender_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  read_at     timestamptz,                     -- set by chat_mark_read for the recipient
  created_at  timestamptz not null default now()
);
-- Conversation load is "messages for a thread, oldest->newest"; unread is
-- "thread, read_at null, sender <> me". Both covered by these indexes.
create index if not exists messages_thread_created_idx on messages (thread_id, created_at);
create index if not exists messages_unread_idx on messages (thread_id, read_at) where read_at is null;

alter table messages enable row level security;
-- NO policies in this migration: RLS-enabled-with-zero-policies = default-deny,
-- the same posture chat_threads uses. Party-read policy is added in 100100.
