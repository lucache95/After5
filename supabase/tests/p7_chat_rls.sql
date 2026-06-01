-- supabase/tests/p7_chat_rls.sql
-- Phase 7 Task 1 + Task 2: messages table shape + party-read RLS (deny-by-default).
\i supabase/tests/_fixtures.sql

-- shape: messages has the 6 expected columns.
DO $$ BEGIN
  ASSERT (select count(*) from information_schema.columns
          where table_schema='public' and table_name='messages'
            and column_name in ('id','thread_id','sender_id','body','read_at','created_at')) = 6,
    'messages must have the 6 expected columns';
  RAISE NOTICE 'P7.1: messages shape OK';
END $$;

-- body length check rejects blank.
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN
    insert into messages(thread_id, sender_id, body)
    values (gen_random_uuid(), gen_random_uuid(), '   ');
  EXCEPTION when check_violation or foreign_key_violation then ok := true; END;
  ASSERT ok, 'blank body or bad fk must be rejected';
  RAISE NOTICE 'P7.1: body length check OK';
END $$;

-- messages enforces RLS (relrowsecurity).
DO $$ BEGIN
  ASSERT (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where c.relname='messages' and n.nspname='public'),
    'messages must have RLS enabled';
  ASSERT (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where c.relname='chat_threads' and n.nspname='public'),
    'chat_threads must have RLS enabled';
  RAISE NOTICE 'P7.1: RLS enabled on messages + chat_threads OK';
END $$;

-- Party-read: creator/candidate can read their thread + messages; a stranger cannot.
DO $$
DECLARE
  cre uuid; cand uuid; stranger uuid; itin uuid; inst uuid; oid uuid; tid uuid;
  n int;
BEGIN
  insert into feature_config(key, value) values ('match_v2_enabled','true'::jsonb)
    on conflict (key) do update set value='true'::jsonb;
  cre := mk_user('rls_cre'); cand := mk_user('rls_cand'); stranger := mk_user('rls_stranger');
  insert into profiles_private(user_id, birthdate)
    values (cre,'1990-01-01'),(cand,'1990-01-01'),(stranger,'1990-01-01')
    on conflict (user_id) do update set birthdate='1990-01-01';
  update profiles set dating_enabled=true where id in (cre, cand, stranger);
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction) values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand, 1);
  oid := (match_make_offer(cre, inst, cand, gen_random_uuid())->>'offer_id')::uuid;
  select id into tid from chat_threads where offer_id = oid;
  -- seed a message (service path / definer-owner via the table directly as superuser).
  insert into messages(thread_id, sender_id, body) values (tid, cre, 'hi there');

  -- creator reads thread + message.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_threads WHERE id = tid;
  ASSERT n = 1, 'creator must read own thread row (saw '||n||')';
  SELECT count(*) INTO n FROM messages WHERE thread_id = tid;
  ASSERT n = 1, 'creator must read own thread messages (saw '||n||')';
  RESET ROLE;

  -- candidate reads thread + message.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_threads WHERE id = tid;
  ASSERT n = 1, 'candidate must read own thread row (saw '||n||')';
  SELECT count(*) INTO n FROM messages WHERE thread_id = tid;
  ASSERT n = 1, 'candidate must read own thread messages (saw '||n||')';
  RESET ROLE;

  -- stranger reads neither (deny-by-default).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_threads WHERE id = tid;
  ASSERT n = 0, 'stranger must NOT read the thread (saw '||n||')';
  SELECT count(*) INTO n FROM messages WHERE thread_id = tid;
  ASSERT n = 0, 'stranger must NOT read the messages (saw '||n||')';

  -- a direct INSERT as authenticated is denied (no write policy).
  DECLARE wrote boolean := false; BEGIN
    BEGIN
      insert into messages(thread_id, sender_id, body) values (tid, stranger, 'sneaky');
      wrote := true;
    EXCEPTION when insufficient_privilege then wrote := false;
    END;
    ASSERT NOT wrote, 'authenticated client must NOT be able to INSERT messages directly';
  END;
  RESET ROLE;

  RAISE NOTICE 'P7.2: party-read + deny-by-default OK';
  ROLLBACK;
END $$;
