-- 20260527127200_p5_job_rpcs_backfill.sql
-- R1 poison-loop fix: backfill the two job-runner RPCs that did not exist.
--
-- The job runner (supabase/functions/process-jobs/handlers.ts) dispatches:
--   bulk_withdraw -> match_bulk_withdraw(p_actor)   -- enqueued by B's safety-cancel
--                                                      (match_cancel_lock 'safety' branch)
--                                                      + autowithdraw overflow path
--                                                      (match_autowithdraw_user_conflicts).
--   rating_window -> close_rating_window(p_lock)     -- enqueued on EVERY match_accept_offer
--                                                      and match_resolve_reciprocal
--                                                      (run_after = lock end + grace).
-- Neither RPC existed, so once those jobs fired they raised 'function does not
-- exist', failed, and retried forever. Both RPCs below are:
--   * SECURITY DEFINER, set search_path=public
--   * service-role-only (called by the runner; revoked from public/anon/authenticated,
--     matching the admin-tooling REVOKE pattern in 20260527127000_p5_c_sql.sql)
--   * IDEMPOTENT (jobs retry) and STALE-TOLERANT (return cleanly on missing/already-
--     resolved input; raising would re-poison the loop).

-- ============================================================================
-- match_bulk_withdraw(p_actor): withdraw the actor from ALL their open
-- engagements across every instance.
-- ============================================================================
-- Mirrors match_withdraw's per-instance semantics, generalized to every instance
-- the actor is engaged on:
--   * active offer to the actor  -> match_resolve_offer_negative(offer,'passed')
--     (this helper already takes the per-instance advisory lock, closes chat,
--      transitions the queue entry, notifies, and auto-rolls — so we reuse it
--      and need no extra lock around offer resolution).
--   * non-offer open queue entries (interested/shortlisted/standby) -> offer_passed.
-- Locking: a coarse advisory lock keyed on the actor serializes concurrent
-- bulk_withdraw runs for the same actor; per-instance offer resolution is further
-- serialized inside match_resolve_offer_negative. We DO NOT take a per-instance
-- lock around the non-offer queue update because those rows aren't part of any
-- offer race (they have no active offer by definition of this branch).
-- Does NOT touch 'locked' queue entries or any lock the actor already holds.
create or replace function match_bulk_withdraw(p_actor uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare rec record; n_offers int := 0; n_queue int := 0;
begin
  if p_actor is null then return; end if;

  -- Coarse per-actor advisory lock (reuse the instance-lock keyspace hashing via
  -- hashtextextended on the actor uuid) so concurrent bulk_withdraw runs for the
  -- same actor don't double-process.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));

  -- 1. Resolve every ACTIVE offer held by the actor (helper is lock-guarded + idempotent).
  for rec in
    select id from offers where candidate_id=p_actor and status='active'
  loop
    perform match_resolve_offer_negative(rec.id, 'passed');
    n_offers := n_offers + 1;
  end loop;

  -- 2. Withdraw remaining OPEN non-offer queue entries (mirror match_withdraw's else branch).
  --    'offer_active' rows are handled by step 1 above; 'locked' is intentionally excluded.
  update queue_entries set status='offer_passed', updated_at=now()
   where candidate_id=p_actor
     and status in ('interested','shortlisted','standby');
  get diagnostics n_queue = row_count;

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_bulk_withdraw', p_actor, 'profile', p_actor,
          jsonb_build_object('offers_resolved', n_offers, 'queue_withdrawn', n_queue));
end $fn$;

-- ============================================================================
-- close_rating_window(p_lock): finalize the rating window for a completed lock.
-- ============================================================================
-- The full rating UX (collecting/blending match_ratings, reliability scoring) is
-- sub-project F. This RPC only CLOSES THE WINDOW so the rating_window job drains
-- instead of poison-looping. There was no rating-window column on `locks`, so we
-- add a nullable `rating_closed_at timestamptz` here and stamp it.
-- Idempotent: only stamps when currently NULL; a second call is a no-op.
-- Stale-tolerant: missing lock id returns cleanly (no raise).
alter table locks add column if not exists rating_closed_at timestamptz;

create or replace function close_rating_window(p_lock uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare existing timestamptz; found_lock boolean;
begin
  if p_lock is null then return; end if;

  select rating_closed_at, true into existing, found_lock
    from locks where id=p_lock for update;
  if not found_lock then return; end if;        -- stale/nonexistent: drain cleanly
  if existing is not null then return; end if;  -- already closed: idempotent no-op

  update locks set rating_closed_at=now(), updated_at=now() where id=p_lock;

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_rating_window_closed', null, 'lock', p_lock, jsonb_build_object());
end $fn$;

-- ============================================================================
-- Grants/REVOKEs: service-role-only (admin-tooling pattern).
-- ============================================================================
revoke all on function match_bulk_withdraw(uuid) from public, anon, authenticated;
revoke all on function close_rating_window(uuid) from public, anon, authenticated;
