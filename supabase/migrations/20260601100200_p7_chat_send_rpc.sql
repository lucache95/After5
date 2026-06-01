-- supabase/migrations/20260601100200_p7_chat_send_rpc.sql
-- Phase 7 chat write path. All SECURITY DEFINER; chat_send_message re-checks
-- auth.uid()=p_actor (the section 2.5 invariant for public-facing RPCs, matching match_*).
-- New errcodes: P5010 chat_not_party, P5011 chat_closed.

-- Gate A: is this thread messageable? Open or promoted, never revoked/closed.
-- (Per DECISIONS LOCKED #1: chat is available pre-lock and survives the lock.)
create or replace function chat_thread_messageable(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select state in ('open','promoted') and revoked_at is null
    from chat_threads where id = p_thread
  ), false);
$$;

-- both_ready (rapport flag, DECISIONS LOCKED #2/#3): true once EACH party has
-- sent >= 1 message. Isolated so the bar is trivial to retune. UI affordance only --
-- it does NOT gate locking (Task 5 dropped; chat_lock_ready is untouched).
create or replace function chat_recompute_both_ready(p_thread uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_creator uuid; v_candidate uuid; v_ready boolean;
begin
  select o.creator_id, o.candidate_id into v_creator, v_candidate
    from chat_threads t join offers o on o.id = t.offer_id where t.id = p_thread;
  v_ready := exists(select 1 from messages where thread_id = p_thread and sender_id = v_creator)
         and exists(select 1 from messages where thread_id = p_thread and sender_id = v_candidate);
  update chat_threads set both_ready = v_ready, updated_at = now()
    where id = p_thread and both_ready is distinct from v_ready;
  return v_ready;
end $fn$;

-- send a message. Asserts actor, party membership, Gate A; inserts; recomputes
-- both_ready; dispatches new_message to the OTHER party. Idempotent on p_idem_key
-- (reuses the transition_idempotency ledger under the 'chat_send' action namespace).
create or replace function chat_send_message(
  p_actor uuid, p_thread uuid, p_body text, p_idem_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_creator uuid; v_candidate uuid; v_other uuid;
  v_msg_id uuid; v_ready boolean; v_existing uuid;
begin
  if p_actor is distinct from (select auth.uid()) then
    raise exception 'auth mismatch' using errcode = 'P5001';
  end if;

  -- idempotency: a retried send with the same key returns the first result.
  v_existing := (match_idem_lookup(p_actor, 'chat_send', p_idem_key)->>'message_id')::uuid;
  if v_existing is not null then
    return jsonb_build_object('kind','message','message_id',v_existing,'idempotent',true);
  end if;

  select o.creator_id, o.candidate_id into v_creator, v_candidate
    from chat_threads t join offers o on o.id = t.offer_id where t.id = p_thread;
  if v_creator is null then
    raise exception 'no such thread' using errcode = 'P5010';
  end if;
  if p_actor <> v_creator and p_actor <> v_candidate then
    raise exception 'not a party to this thread' using errcode = 'P5010';
  end if;
  if not chat_thread_messageable(p_thread) then
    raise exception 'chat thread is closed' using errcode = 'P5011';
  end if;

  insert into messages(thread_id, sender_id, body)
    values (p_thread, p_actor, btrim(p_body)) returning id into v_msg_id;

  v_ready := chat_recompute_both_ready(p_thread);
  v_other := case when p_actor = v_creator then v_candidate else v_creator end;

  perform dispatch_notification(v_other, 'new_message',
    jsonb_build_object('thread_id', p_thread, 'message_id', v_msg_id, 'from', p_actor));

  perform match_idem_store(p_actor, 'chat_send', p_idem_key,
    jsonb_build_object('message_id', v_msg_id));

  return jsonb_build_object('kind','message','message_id',v_msg_id,'both_ready',v_ready);
end $fn$;

-- recipient marks all unread messages in a thread as read. Takes only p_thread and
-- derives the actor from auth.uid() (it mutates only the caller's own read state and
-- is guarded by chat_thread_party), so the authenticated browser client may call it
-- directly -- same posture as notifications mark-read. Returns count updated.
create or replace function chat_mark_read(p_thread uuid) returns integer
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := (select auth.uid()); v_n int;
begin
  if v_uid is null then raise exception 'auth mismatch' using errcode = 'P5001'; end if;
  if not chat_thread_party(p_thread, v_uid) then
    raise exception 'not a party to this thread' using errcode = 'P5010';
  end if;
  update messages set read_at = now()
    where thread_id = p_thread and sender_id <> v_uid and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function chat_thread_messageable(uuid) from public, anon, authenticated;
revoke execute on function chat_recompute_both_ready(uuid) from public, anon, authenticated;
revoke execute on function chat_send_message(uuid, uuid, text, uuid) from public, anon, authenticated;
-- chat_mark_read is callable by the authenticated client (mutates only own read state).
revoke execute on function chat_mark_read(uuid) from public, anon;
grant execute on function chat_mark_read(uuid) to authenticated;
