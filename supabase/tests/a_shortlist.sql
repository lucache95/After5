-- supabase/tests/a_shortlist.sql
-- A.3: match_shortlist + match_ingest_interest behavior.
\i supabase/tests/_fixtures.sql

-- Enable feature flag for tests
update feature_config set value='true'::jsonb where key='match_v2_enabled';

DO $$
DECLARE cre uuid; cand1 uuid; cand2 uuid; itin uuid; inst uuid; n int;
BEGIN
  -- Bootstrap feature_config if it doesn't have match_v2_enabled yet
  insert into feature_config(key, value) values ('match_v2_enabled', 'true'::jsonb)
    on conflict (key) do update set value='true'::jsonb;

  cre := mk_user('sl_cre');
  cand1 := mk_user('sl_cand1');
  cand2 := mk_user('sl_cand2');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- Seed right-swipes (S5's record_swipe would do this in real flow; we insert directly here)
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
  values (cand1, inst, cre, 'right'), (cand2, inst, cre, 'right');

  -- match_ingest_interest seeds queue_entries from those swipes
  n := match_ingest_interest(inst);
  IF n <> 2 THEN RAISE EXCEPTION 'A.3: ingest_interest expected 2 rows, got %', n; END IF;

  -- Re-running is idempotent (on conflict do nothing)
  n := match_ingest_interest(inst);
  IF n <> 0 THEN RAISE EXCEPTION 'A.3: ingest_interest replay should be no-op, got %', n; END IF;

  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand1 AND status='interested';
  IF NOT FOUND THEN RAISE EXCEPTION 'A.3: cand1 should be interested after ingest'; END IF;

  -- Set auth.uid to cre and shortlist cand1 at rank 1
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM match_shortlist(cre, inst, cand1, 1);
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand1
    AND status='shortlisted' AND rank=1 AND swiper_disclosed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.3: cand1 should be shortlisted rank=1 with disclosed_at'; END IF;

  -- Shortlist cand2 at rank 2
  PERFORM match_shortlist(cre, inst, cand2, 2);
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=cand2
    AND status='shortlisted' AND rank=2;
  IF NOT FOUND THEN RAISE EXCEPTION 'A.3: cand2 should be shortlisted rank=2'; END IF;

  -- match_next_standby returns lowest-rank shortlisted
  IF match_next_standby(inst) <> cand1 THEN
    RAISE EXCEPTION 'A.3: next_standby should return cand1 (rank 1)';
  END IF;

  RAISE NOTICE 'A.3: shortlist + ingest_interest OK';
  ROLLBACK;
END $$;

-- Negative-auth: caller mismatching auth.uid() raises P5001
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  cre := mk_user('sl2_cre');
  cand := mk_user('sl2_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
  values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  -- auth.uid() is null (no JWT set); calling with p_actor=cre should raise P5001
  BEGIN
    PERFORM match_shortlist(cre, inst, cand, 1);
  EXCEPTION
    WHEN sqlstate 'P5001' THEN ok := true;
    WHEN others THEN
      RAISE EXCEPTION 'A.3: expected P5001 auth_mismatch, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.3: shortlist with no auth must raise P5001'; END IF;
  RAISE NOTICE 'A.3: shortlist P5001 auth_mismatch OK';
  ROLLBACK;
END $$;

-- Feature-flag-off raises P5000
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; ok boolean := false;
BEGIN
  -- temporarily disable
  update feature_config set value='false'::jsonb where key='match_v2_enabled';
  cre := mk_user('sl3_cre');
  cand := mk_user('sl3_cand');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');
  insert into swipes(swiper_id, date_instance_id, creator_id, direction)
  values (cand, inst, cre, 'right');
  PERFORM match_ingest_interest(inst);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  BEGIN
    PERFORM match_shortlist(cre, inst, cand, 1);
  EXCEPTION
    WHEN sqlstate 'P5000' THEN ok := true;
    WHEN others THEN
      RAISE EXCEPTION 'A.3: expected P5000 feature_disabled, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A.3: shortlist with flag off must raise P5000'; END IF;
  RAISE NOTICE 'A.3: shortlist P5000 feature_disabled OK';
  ROLLBACK;
END $$;
