-- supabase/tests/p7_chat_send.sql
-- Phase 7 Task 3 + Task 4: chat_send_message, chat_recompute_both_ready,
-- chat_mark_read, gates, idempotency, notification dispatch, realtime publication.
\i supabase/tests/_fixtures.sql

insert into feature_config(key, value) values ('match_v2_enabled','true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- Helper: build a fresh open thread, return creator/candidate/thread via OUT params.
create or replace function _p7_seed_thread(p_label text,
  OUT cre uuid, OUT cand uuid, OUT tid uuid)
language plpgsql as $$
declare itin uuid; inst uuid; oid uuid;
begin
  cre := mk_user(p_label||'_cre'); cand := mk_user(p_label||'_cand');
  insert into profiles_private(user_id, birthdate) values (cre,'1990-01-01'),(cand,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  perform match_ingest_interest(inst);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  perform match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;
  select id into tid from chat_threads where offer_id = oid;
end $$;

-- Happy path: send from creator (both_ready false), then candidate (both_ready true),
-- notification dispatched, mark_read, idempotency replay.
DO $$
DECLARE cre uuid; cand uuid; tid uuid; res jsonb; idem uuid; n int;
BEGIN
  SELECT * INTO cre, cand, tid FROM _p7_seed_thread('snd1');

  -- creator sends (only one party -> both_ready false).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  res := chat_send_message(cre, tid, '  hey there  ', gen_random_uuid());
  ASSERT res->>'kind' = 'message', 'send must return kind=message (got '||res::text||')';
  ASSERT (res->>'both_ready')::boolean = false, 'both_ready must be false after only creator sent';
  -- body is trimmed.
  ASSERT exists(select 1 from messages where thread_id=tid and sender_id=cre and body='hey there'),
    'body must be btrim-ed on insert';

  -- candidate sends (mutual signal -> both_ready true).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  idem := gen_random_uuid();
  res := chat_send_message(cand, tid, 'hi!', idem);
  ASSERT (res->>'both_ready')::boolean = true, 'both_ready must flip true after each party sent >=1';
  ASSERT (select both_ready from chat_threads where id=tid) = true,
    'chat_threads.both_ready must be persisted true';

  -- idempotency: same key replays, no second row.
  res := chat_send_message(cand, tid, 'hi!', idem);
  ASSERT (res->>'idempotent')::boolean = true, 'idempotent replay must flag idempotent=true';
  SELECT count(*) INTO n FROM messages WHERE thread_id=tid AND sender_id=cand;
  ASSERT n = 1, 'idempotent replay must not insert a second message (saw '||n||')';

  -- notification dispatched to the OTHER party for each send.
  ASSERT exists(select 1 from notifications where user_id=cand and type='new_message'
                and payload->>'thread_id' = tid::text),
    'new_message notification must reach candidate';
  ASSERT exists(select 1 from notifications where user_id=cre and type='new_message'
                and payload->>'thread_id' = tid::text),
    'new_message notification must reach creator';

  -- chat_mark_read: candidate marks the creator's message read.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  n := chat_mark_read(tid);
  ASSERT n = 1, 'mark_read should mark 1 unread message from the other party (got '||n||')';
  -- second call is a no-op.
  n := chat_mark_read(tid);
  ASSERT n = 0, 'second mark_read should mark 0 (got '||n||')';

  RAISE NOTICE 'P7.3: send happy path + both_ready + idempotency + notify + mark_read OK';
  ROLLBACK;
END $$;

-- P5001: auth mismatch (p_actor != auth.uid()).
DO $$
DECLARE cre uuid; cand uuid; tid uuid; ok boolean := false;
BEGIN
  SELECT * INTO cre, cand, tid FROM _p7_seed_thread('snd2');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  BEGIN
    PERFORM chat_send_message(cre, tid, 'spoof', gen_random_uuid());
  EXCEPTION when sqlstate 'P5001' then ok := true;
  END;
  ASSERT ok, 'actor != auth.uid() must raise P5001';
  RAISE NOTICE 'P7.3: P5001 auth mismatch OK';
  ROLLBACK;
END $$;

-- P5010: non-party actor.
DO $$
DECLARE cre uuid; cand uuid; tid uuid; stranger uuid; ok boolean := false;
BEGIN
  SELECT * INTO cre, cand, tid FROM _p7_seed_thread('snd3');
  stranger := mk_user('snd3_stranger');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  BEGIN
    PERFORM chat_send_message(stranger, tid, 'intruder', gen_random_uuid());
  EXCEPTION when sqlstate 'P5010' then ok := true;
  END;
  ASSERT ok, 'non-party send must raise P5010';
  RAISE NOTICE 'P7.3: P5010 non-party OK';
  ROLLBACK;
END $$;

-- P5011: closed thread is not messageable.
DO $$
DECLARE cre uuid; cand uuid; tid uuid; ok boolean := false;
BEGIN
  SELECT * INTO cre, cand, tid FROM _p7_seed_thread('snd4');
  update chat_threads set state='closed' where id=tid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  BEGIN
    PERFORM chat_send_message(cre, tid, 'too late', gen_random_uuid());
  EXCEPTION when sqlstate 'P5011' then ok := true;
  END;
  ASSERT ok, 'send to closed thread must raise P5011';
  -- promoted thread IS still messageable (Gate A: open|promoted).
  update chat_threads set state='promoted' where id=tid;
  ASSERT chat_thread_messageable(tid) = true, 'promoted thread must remain messageable';
  -- revoked thread is not.
  update chat_threads set state='open', revoked_at=now() where id=tid;
  ASSERT chat_thread_messageable(tid) = false, 'revoked thread must NOT be messageable';
  RAISE NOTICE 'P7.3: P5011 closed + Gate A combos OK';
  ROLLBACK;
END $$;

-- mark_read by a non-party raises P5010.
DO $$
DECLARE cre uuid; cand uuid; tid uuid; stranger uuid; ok boolean := false;
BEGIN
  SELECT * INTO cre, cand, tid FROM _p7_seed_thread('snd5');
  stranger := mk_user('snd5_stranger');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  BEGIN PERFORM chat_mark_read(tid); EXCEPTION when sqlstate 'P5010' then ok := true; END;
  ASSERT ok, 'mark_read by non-party must raise P5010';
  RAISE NOTICE 'P7.3: mark_read non-party P5010 OK';
  ROLLBACK;
END $$;

-- Task 4: messages is in the realtime publication.
DO $$ BEGIN
  ASSERT exists(select 1 from pg_publication_tables
                where pubname='supabase_realtime' and tablename='messages'),
    'messages must be in the supabase_realtime publication';
  RAISE NOTICE 'P7.4: messages in realtime publication OK';
END $$;

drop function if exists _p7_seed_thread(text);
