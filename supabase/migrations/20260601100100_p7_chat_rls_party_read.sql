-- supabase/migrations/20260601100100_p7_chat_rls_party_read.sql
-- Phase 7 participant-read RLS (deferred here by Z spec section 7.2). Parties derive
-- from offer.creator_id + offer.candidate_id. SELECT-only; all writes are via
-- SECURITY DEFINER RPCs (chat_send_message / chat_mark_read / report_message), so no
-- client INSERT/UPDATE/DELETE policy exists -> those verbs stay default-denied.

-- Membership helper. SECURITY DEFINER + set search_path so the policy can join
-- offers without recursing into chat_threads' own RLS. Returns a boolean only --
-- no row data leaks. STABLE: pure read.
create or replace function chat_thread_party(p_thread uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_threads t join offers o on o.id = t.offer_id
    where t.id = p_thread and (o.creator_id = p_uid or o.candidate_id = p_uid)
  );
$$;
revoke execute on function chat_thread_party(uuid, uuid) from public, anon;
grant execute on function chat_thread_party(uuid, uuid) to authenticated;

-- chat_threads: a party may read their own thread row.
drop policy if exists chat_threads_party_read on chat_threads;
create policy chat_threads_party_read on chat_threads for select to authenticated
  using (chat_thread_party(id, (select auth.uid())));

-- messages: a party may read messages in a thread they belong to.
drop policy if exists messages_party_read on messages;
create policy messages_party_read on messages for select to authenticated
  using (chat_thread_party(thread_id, (select auth.uid())));
