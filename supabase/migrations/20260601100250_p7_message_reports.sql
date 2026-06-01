-- supabase/migrations/20260601100250_p7_message_reports.sql
-- Phase 7 minimal moderation (DECISIONS LOCKED #5). A party to a message's thread
-- (but NOT its sender) can report a received message. Reports land in this table;
-- no admin review-queue this round (follow-up flagged in plan section 8).
-- New errcode: P5012 cannot_report (not a party, or reporting own message).
create table if not exists message_reports (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references messages(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  -- one report per reporter per message -> idempotent re-report.
  unique (message_id, reporter_id)
);

alter table message_reports enable row level security;
-- Deny-by-default: RLS enabled, ZERO policies. Reports are written only via the
-- SECURITY DEFINER report_message RPC; no client read/write of this table.

-- report_message(p_actor, p_message, p_reason): asserts the actor is a party to the
-- message's thread AND is NOT the sender, then inserts a report idempotently.
-- SECURITY DEFINER; re-checks auth.uid()=p_actor (matching the match_* invariant).
create or replace function report_message(p_actor uuid, p_message uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_thread uuid; v_sender uuid; v_report_id uuid;
begin
  if p_actor is distinct from (select auth.uid()) then
    raise exception 'auth mismatch' using errcode = 'P5001';
  end if;

  select thread_id, sender_id into v_thread, v_sender
    from messages where id = p_message;
  if v_thread is null then
    raise exception 'no such message' using errcode = 'P5012';
  end if;
  if p_actor = v_sender then
    raise exception 'cannot report your own message' using errcode = 'P5012';
  end if;
  if not chat_thread_party(v_thread, p_actor) then
    raise exception 'not a party to this thread' using errcode = 'P5012';
  end if;

  insert into message_reports(message_id, reporter_id, reason)
    values (p_message, p_actor, p_reason)
  on conflict (message_id, reporter_id) do update set reason = coalesce(excluded.reason, message_reports.reason)
  returning id into v_report_id;

  return jsonb_build_object('kind','report','report_id',v_report_id);
end $fn$;

revoke execute on function report_message(uuid, uuid, text) from public, anon, authenticated;
