-- supabase/tests/p2_analytics_events.sql
-- C11.12 shape: id bigint generated always as identity, event_type text, actor_id uuid,
-- subject_type text, subject_id uuid, payload jsonb, created_at timestamptz.
-- Writer: emit_analytics(event_type, actor_id, subject_type, subject_id, payload).
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; eid bigint; n int;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='analytics_events' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events missing or RLS off'; END IF;

  -- C11.12 column checks
  PERFORM 1 FROM information_schema.columns WHERE table_name='analytics_events' AND column_name='event_type';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.event_type missing (C11.12)'; END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_name='analytics_events' AND column_name='actor_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.actor_id missing (C11.12)'; END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_name='analytics_events' AND column_name='subject_type';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.subject_type missing (C11.12)'; END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_name='analytics_events' AND column_name='subject_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.subject_id missing (C11.12)'; END IF;

  PERFORM 1 FROM information_schema.columns WHERE table_name='analytics_events' AND column_name='payload';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.payload missing (C11.12)'; END IF;

  -- id is bigint generated always as identity (not uuid)
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='analytics_events' AND column_name='id' AND data_type='bigint';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.id should be bigint (C11.12)'; END IF;

  -- emit_analytics writer works
  u := mk_user('ana');
  eid := emit_analytics('offer_made', u, 'offer', gen_random_uuid(), '{"test":true}'::jsonb);
  IF eid IS NULL THEN RAISE EXCEPTION 'emit_analytics returned null id'; END IF;

  SELECT count(*) INTO n FROM analytics_events WHERE id=eid AND event_type='offer_made';
  IF n <> 1 THEN RAISE EXCEPTION 'emit_analytics did not insert row'; END IF;

  RAISE NOTICE 'analytics_events OK';
  ROLLBACK;
END $$;
