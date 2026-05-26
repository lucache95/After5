-- supabase/tests/p2_jobs_rpcs.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE j1 uuid; j2 uuid; n int; claimed int; cancelled int;
BEGIN
  -- idempotent enqueue: same (type, dedup_key) twice while pending → one row
  j1 := enqueue_job('safety_checkin', now() + interval '1 minute', '{}'::jsonb, 'sc:fixture');
  j2 := enqueue_job('safety_checkin', now() + interval '5 minute', '{}'::jsonb, 'sc:fixture');
  IF j1 <> j2 THEN RAISE EXCEPTION 'enqueue not idempotent: % <> %', j1, j2; END IF;
  SELECT count(*) INTO n FROM jobs WHERE dedup_key='sc:fixture' AND status='pending';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 pending dedup row, got %', n; END IF;

  -- due-in-past is claimable; due-in-future is not
  PERFORM enqueue_job('offer_expiry', now() - interval '1 minute', '{}'::jsonb, 'due:past');
  PERFORM enqueue_job('offer_expiry', now() + interval '1 hour',  '{}'::jsonb, 'due:future');
  SELECT count(*) INTO claimed FROM claim_due_jobs(10);
  IF claimed <> 1 THEN RAISE EXCEPTION 'claim_due_jobs returned %, expected 1', claimed; END IF;
  PERFORM 1 FROM jobs WHERE dedup_key='due:past' AND status='running' AND locked_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'claimed job not marked running/locked'; END IF;

  -- cancel_jobs cancels the pending due:future row (C1; P5 calls this on accept)
  cancelled := cancel_jobs('offer_expiry', 'due:future');
  IF cancelled <> 1 THEN RAISE EXCEPTION 'cancel_jobs cancelled %, expected 1', cancelled; END IF;
  PERFORM 1 FROM jobs WHERE dedup_key='due:future' AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_jobs did not mark cancelled'; END IF;

  RAISE NOTICE 'jobs RPCs OK';
  ROLLBACK;
END $$;
