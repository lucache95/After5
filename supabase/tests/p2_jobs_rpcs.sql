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

-- complete_job / fail_job lifecycle + cancel-race guard
DO $$
DECLARE jid uuid; st job_status; ra timestamptz; att int;
BEGIN
  -- complete_job only acts on a RUNNING job
  jid := enqueue_job('notify', now() - interval '1 minute', '{}'::jsonb, 'cj:1');
  PERFORM claim_due_jobs(10);  -- jid -> running, attempts=1
  PERFORM complete_job(jid);
  SELECT status INTO st FROM jobs WHERE id=jid;
  IF st <> 'done' THEN RAISE EXCEPTION 'complete_job: expected done, got %', st; END IF;

  -- cancel-race guard: a cancelled (not running) job is NOT resurrected by complete/fail
  jid := enqueue_job('notify', now() - interval '1 minute', '{}'::jsonb, 'cj:2');
  PERFORM claim_due_jobs(10);                 -- running
  UPDATE jobs SET status='cancelled' WHERE id=jid;  -- simulate cancel_jobs winning the race
  PERFORM complete_job(jid);
  PERFORM fail_job(jid, 'late failure');
  SELECT status INTO st FROM jobs WHERE id=jid;
  IF st <> 'cancelled' THEN RAISE EXCEPTION 'cancelled job clobbered to %, expected cancelled', st; END IF;

  -- fail_job: a running job under threshold re-queues (pending) with future backoff
  jid := enqueue_job('notify', now() - interval '1 minute', '{}'::jsonb, 'cj:3');
  PERFORM claim_due_jobs(10);                 -- attempts=1, running
  PERFORM fail_job(jid, 'boom');
  SELECT status, run_after, attempts INTO st, ra, att FROM jobs WHERE id=jid;
  IF st <> 'pending' THEN RAISE EXCEPTION 'fail_job(<5): expected pending re-queue, got %', st; END IF;
  IF ra <= now() THEN RAISE EXCEPTION 'fail_job: backoff did not push run_after into the future'; END IF;

  -- fail_job dead-letter: at attempts>=5 (C1 frozen threshold) the job is failed permanently
  UPDATE jobs SET status='running', attempts=5, locked_at=now() WHERE id=jid;
  PERFORM fail_job(jid, 'final');
  SELECT status INTO st FROM jobs WHERE id=jid;
  IF st <> 'failed' THEN RAISE EXCEPTION 'fail_job(>=5): expected dead-letter failed, got %', st; END IF;

  -- requeue_stuck_jobs recovers a row stuck running past the grace window
  jid := enqueue_job('notify', now() - interval '1 minute', '{}'::jsonb, 'cj:4');
  UPDATE jobs SET status='running', locked_at = now() - interval '10 minutes' WHERE id=jid;
  PERFORM requeue_stuck_jobs(interval '5 minutes');
  SELECT status INTO st FROM jobs WHERE id=jid;
  IF st <> 'pending' THEN RAISE EXCEPTION 'requeue_stuck_jobs: expected pending, got %', st; END IF;

  RAISE NOTICE 'jobs lifecycle (complete/fail/backoff/dead-letter/requeue/cancel-guard) OK';
  ROLLBACK;
END $$;
