-- supabase/migrations/20260525123100_p2_jobs_rpcs.sql
-- Canonical job RPCs (INTEGRATION-CONTRACT C1). Exact signatures; callers across
-- S6/S7/S8/S10/S12 use these names. Entity refs live in payload jsonb.

-- Idempotent enqueue. If a pending|running job with the same (type, dedup_key)
-- exists, return its id unchanged. dedup_key null => no dedup (every call inserts).
create or replace function enqueue_job(
  p_type      job_type,
  p_run_after timestamptz,
  p_payload   jsonb default '{}',
  p_dedup_key text default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if p_dedup_key is not null then
    select id into v_id from jobs
     where type = p_type and dedup_key = p_dedup_key and status in ('pending','running')
     limit 1;
    if found then return v_id; end if;
  end if;

  insert into jobs (type, run_after, payload, dedup_key)
  values (p_type, p_run_after, coalesce(p_payload,'{}'), p_dedup_key)
  on conflict (type, dedup_key) where (status in ('pending','running') and dedup_key is not null)
    do nothing
  returning id into v_id;

  if v_id is null and p_dedup_key is not null then
    select id into v_id from jobs
     where type = p_type and dedup_key = p_dedup_key and status in ('pending','running')
     limit 1;
  end if;
  -- An unkeyed insert always returns an id; a null here means the insert silently
  -- produced no row (e.g. a future trigger) — fail loud rather than hand back null.
  if v_id is null and p_dedup_key is null then
    raise exception 'enqueue_job: insert returned no id for type %', p_type;
  end if;
  return v_id;
end $fn$;

-- Cancel pending|running jobs matching (type, dedup_key). Returns rows cancelled.
-- P5's match_accept_offer calls cancel_jobs('offer_expiry', offer_id) so a
-- resolved offer's timer never fires.
create or replace function cancel_jobs(p_type job_type, p_dedup_key text)
returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update jobs set status='cancelled'
   where type = p_type and dedup_key = p_dedup_key and status in ('pending','running');
  get diagnostics n = row_count;
  return n;
end $fn$;

-- Atomically claim up to N due jobs (pending→running, stamp locked_at, +attempts).
-- SKIP LOCKED makes concurrent runners / overlapping ticks safe. NOTE: order is a
-- best-effort priority, not a strict FIFO guarantee — SKIP LOCKED skips per-row as
-- encountered, so under concurrent runners a later row may be claimed before an
-- earlier locked one. Acceptable for a minute-granular timer queue.
create or replace function claim_due_jobs(p_limit int default 50)
returns setof jobs
language plpgsql security definer set search_path = public as $fn$
begin
  if p_limit <= 0 then raise exception 'claim_due_jobs: p_limit must be > 0'; end if;
  return query
  with due as (
    select id from jobs
     where status = 'pending' and run_after <= now()
     order by run_after
     for update skip locked
     limit p_limit
  )
  update jobs j
     set status = 'running', locked_at = now(), attempts = j.attempts + 1
    from due where j.id = due.id
  returning j.*;
end $fn$;

-- Only a *running* job can complete. The status guard prevents a job that was
-- cancelled mid-flight (cancel_jobs races the runner) from being clobbered back to 'done'.
create or replace function complete_job(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update jobs set status='done', last_error=null where id=p_id and status='running';
end $fn$;

-- Retry with exponential backoff; dead-letter at attempts>=5 (C1's frozen threshold —
-- attempts is incremented at claim time, so this is up to 5 attempts then dead-letter).
-- Guarded on status='running' so a job cancelled mid-flight is not resurrected.
create or replace function fail_job(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $fn$
declare a int;
begin
  select attempts into a from jobs where id=p_id and status='running';
  if not found then return; end if;   -- already cancelled/done/failed — no-op
  if a >= 5 then
    update jobs set status='failed', last_error=p_error where id=p_id;
  else
    update jobs
       set status='pending', last_error=p_error, locked_at=null,
           run_after = now() + (interval '1 minute' * power(2, least(a,6)))
     where id=p_id;
  end if;
end $fn$;

-- Recover crashed runners: jobs stuck 'running' past a grace window → 'pending'.
-- `locked_at is null` is included so a running row that never got stamped (a future
-- bug) is still recoverable rather than invisible (NULL < ts is NULL → never matches).
create or replace function requeue_stuck_jobs(p_grace interval default interval '5 minutes')
returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update jobs set status='pending', locked_at=null
   where status='running' and (locked_at is null or locked_at < now() - p_grace);
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke execute on function enqueue_job(job_type, timestamptz, jsonb, text) from public, authenticated;
revoke execute on function cancel_jobs(job_type, text) from public, authenticated;
revoke execute on function claim_due_jobs(int) from public, authenticated;
revoke execute on function complete_job(uuid) from public, authenticated;
revoke execute on function fail_job(uuid, text) from public, authenticated;
revoke execute on function requeue_stuck_jobs(interval) from public, authenticated;
