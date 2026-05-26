-- supabase/tests/p2_jobs.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='jobs' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs missing or RLS off'; END IF;
  -- C1 column names
  PERFORM 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='type';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.type (job_type) column missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='run_after';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.run_after column missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='dedup_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.dedup_key column missing'; END IF;
  -- full job_type enum (spot-check the consumer-critical values)
  IF NOT ('offer_expiry' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing offer_expiry'; END IF;
  IF NOT ('analytics_relay' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing analytics_relay'; END IF;
  IF NOT ('chat_purge' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing chat_purge'; END IF;
  IF NOT ('deletion_process' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing deletion_process'; END IF;
  -- full job_type enum has exactly 13 values (C1)
  IF (SELECT count(*) FROM unnest(enum_range(null::job_type))) <> 13
    THEN RAISE EXCEPTION 'job_type must have exactly 13 values'; END IF;
  -- C1 active-dedup unique index
  PERFORM 1 FROM pg_indexes WHERE tablename='jobs' AND indexname='jobs_dedup_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs_dedup_active index missing'; END IF;
  -- runner hot-path index (due pending jobs)
  PERFORM 1 FROM pg_indexes WHERE tablename='jobs' AND indexname='jobs_due_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs_due_idx missing'; END IF;
END $$;
