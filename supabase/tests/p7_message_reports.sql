-- supabase/tests/p7_message_reports.sql
-- Phase 7 DECISIONS LOCKED #5: report_message party-only, not-own-message, idempotent.
\i supabase/tests/_fixtures.sql

insert into feature_config(key, value) values ('match_v2_enabled','true'::jsonb)
  on conflict (key) do update set value='true'::jsonb;

-- shape: message_reports columns + unique(message_id, reporter_id) + RLS.
DO $$ BEGIN
  ASSERT (select count(*) from information_schema.columns
          where table_name='message_reports'
            and column_name in ('id','message_id','reporter_id','reason','created_at')) = 5,
    'message_reports must have the 5 expected columns';
  ASSERT (select relrowsecurity from pg_class where relname='message_reports'),
    'message_reports must have RLS enabled';
  ASSERT exists(select 1 from pg_constraint
                where conrelid='message_reports'::regclass and contype='u'),
    'message_reports must have a unique constraint (message_id, reporter_id)';
  RAISE NOTICE 'P7.5: message_reports shape + RLS OK';
END $$;

DO $$
DECLARE
  cre uuid; cand uuid; stranger uuid; itin uuid; inst uuid; oid uuid; tid uuid;
  msg_by_cre uuid; res jsonb; ok boolean; n int;
BEGIN
  cre := mk_user('rpt_cre'); cand := mk_user('rpt_cand'); stranger := mk_user('rpt_stranger');
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
  -- creator sends a message that the candidate can report.
  res := chat_send_message(cre, tid, 'a message', gen_random_uuid());
  msg_by_cre := (res->>'message_id')::uuid;

  -- candidate (a party, not the sender) reports it -> kind=report.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  res := report_message(cand, msg_by_cre, 'creepy');
  ASSERT res->>'kind' = 'report', 'report must return kind=report (got '||res::text||')';
  ASSERT exists(select 1 from message_reports where message_id=msg_by_cre and reporter_id=cand),
    'report row must be inserted';

  -- idempotent: re-report by same reporter -> still 1 row.
  PERFORM report_message(cand, msg_by_cre, 'creepy again');
  SELECT count(*) INTO n FROM message_reports WHERE message_id=msg_by_cre AND reporter_id=cand;
  ASSERT n = 1, 'report must be idempotent per (message, reporter) (saw '||n||')';

  -- P5012: sender cannot report own message.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  ok := false;
  BEGIN PERFORM report_message(cre, msg_by_cre, 'self'); EXCEPTION when sqlstate 'P5012' then ok := true; END;
  ASSERT ok, 'sender reporting own message must raise P5012';

  -- P5012: non-party cannot report.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  ok := false;
  BEGIN PERFORM report_message(stranger, msg_by_cre, 'nosey'); EXCEPTION when sqlstate 'P5012' then ok := true; END;
  ASSERT ok, 'non-party reporting must raise P5012';

  -- P5001: actor != auth.uid().
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cand::text)::text, true);
  ok := false;
  BEGIN PERFORM report_message(stranger, msg_by_cre, 'spoof'); EXCEPTION when sqlstate 'P5001' then ok := true; END;
  ASSERT ok, 'actor != auth.uid() must raise P5001';

  RAISE NOTICE 'P7.5: report_message party-only + not-own + idempotent OK';
  ROLLBACK;
END $$;
