-- 20260604121000_e5_loop_completion.sql
-- Phase 02 (Loop Closure & Host Controls) Wave 2 — E5 loop terminus (D-01/D-02/D-03).
--
-- Two RPCs:
--   sweep_loop_terminus()            — service-role-only batch sweep (called by the
--                                      /api/cron/close-loop Vercel cron). Idempotent,
--                                      stale-tolerant, NEVER raises (a raise re-poisons
--                                      the loop — mirrors close_rating_window's posture in
--                                      20260527127200_p5_job_rpcs_backfill.sql).
--                                      (a) past-dated ACTIVE locks  -> 'completed', and
--                                          their matched date_instances -> 'completed';
--                                      (b) past-dated unmatched 'seeking' nights -> 'expired'
--                                          (D-02/D-10 — 'expired', NOT 'completed': a night
--                                          that never matched is distinct from a date that ran).
--   flag_no_show(p_actor,p_lock,p_idem_key)
--                                    — DEFINER RPC, MEMBERSHIP auth (Pitfall 5 / D-01: EITHER
--                                      lock party may flag, not creator-only like E6/E7). Sets
--                                      the previously-unreachable locks.status='no_show'.
--                                      LOCK-LEVEL ONLY — never touches date_instances.status
--                                      (Pitfall 1: date_match_status has NO 'no_show' value;
--                                      writing it throws invalid_input_value_for_enum).
--
-- E5 only PRODUCES the terminal states + no-show signal (D-03). reliability_score
-- aggregation is E17/Phase 6 — keep the completed/no_show/rating-window shape clean for it.
--
-- Rating-window coordination (REQUIRED — verified against accept_lock + close_rating_window):
--   match_accept_offer (20260527126400_p5_accept_lock.sql, step 16, line 127-130) ENQUEUES
--     enqueue_job('rating_window', upper(rng)+'2 hours', {lock_id, instance}, 'rating:'||lid)
--   close_rating_window(p_lock) (20260527127200, line 79-94) takes an EXPLICIT p_lock and only
--     stamps the handed-in lock; it does NOT self-discover completed-but-unstamped locks.
--   The rating_window job handler (process-jobs/handlers.ts) calls close_rating_window with
--     p_lock = payload.lock_id.
--   => A cron-completed lock that does not enqueue would NEVER reach a rating window, leaving
--      E17 nothing to aggregate. sweep_loop_terminus therefore enqueues 'rating_window' for each
--      newly-completed lock, mirroring accept_lock's grace anchor (upper(time_range)+2h) and
--      dedup key ('rating:'||lock_id) so a duplicate sweep collapses to one job.
--
-- Grace anchor: upper(time_range) + grace, matching accept_lock's rating-window convention.
-- COMPLETION_GRACE = 3 hours (Claude's-discretion default per D-01); the rating_window job's
-- run_after stays upper(time_range)+2h (accept_lock's value) so cron- and accept-path
-- completions open the rating window at the SAME wall-clock anchor.
--
-- GATED — LOCAL ONLY this phase. Prod apply is owner-approved and batched separately; do NOT
-- db:push this to prod from here. Depends on 20260604120000 (the 'expired' enum value).

-- ============================================================================
-- sweep_loop_terminus(): service-role-only, idempotent, stale-tolerant, never raises.
-- ============================================================================
create or replace function sweep_loop_terminus()
returns int language plpgsql security definer set search_path=public as $fn$
declare
  rec record;
  n int := 0;
begin
  -- (a) COMPLETION (D-01): active locks whose night ended + grace -> completed (both tables),
  --     then OPEN the rating window for each newly-completed lock (see header — accept_lock
  --     enqueues this; close_rating_window does NOT self-discover, so cron must enqueue too).
  --     CTE captures the locks that THIS sweep transitioned (status was 'active', now 'completed')
  --     so a re-run does not re-enqueue (only currently-'active' rows are picked up).
  for rec in
    with done as (
      update locks l
         set status='completed', updated_at=now()
       where l.status='active'
         and upper((select d.time_range from date_instances d where d.id=l.date_instance_id))
             + interval '3 hours' < now()          -- COMPLETION_GRACE = 3h (D-01 discretion)
      returning l.id as lock_id, l.date_instance_id
    ),
    di as (
      update date_instances d
         set status='completed', updated_at=now()
       where d.id in (select date_instance_id from done)
         and d.status='matched'
      returning d.id, d.time_range
    )
    select done.lock_id, done.date_instance_id,
           (select d.time_range from date_instances d where d.id=done.date_instance_id) as rng
      from done
  loop
    -- Rating window: same anchor as accept_lock (upper(time_range)+2h) + same dedup key.
    -- enqueue_job is idempotent on (type, dedup_key) so a duplicate sweep is a no-op here.
    perform enqueue_job(
      'rating_window',
      upper(rec.rng) + interval '2 hours',
      jsonb_build_object('lock_id', rec.lock_id, 'instance', rec.date_instance_id),
      'rating:'||rec.lock_id::text
    );
    n := n + 1;
  end loop;

  -- (b) EXPIRY (D-02/D-10): past-dated UNMATCHED seeking nights -> 'expired' (NOT 'completed').
  --     A seeking night has no lock, so nothing to complete or rate.
  update date_instances
     set status='expired', updated_at=now()
   where status='seeking'
     and lower(time_range) + interval '3 hours' < now();   -- same grace anchor as completion
  -- (deliberately not added to n; n counts completed locks rated. The route logs both via
  --  the function's return; expiry is a fire-and-forget terminal sweep.)

  return n;
exception
  -- Stale-tolerant: a batch sweep must NEVER raise (a raise poison-loops the cron). Any
  -- unexpected error is swallowed; the next tick retries. (Mirrors close_rating_window's
  -- never-raise contract; here we wrap the whole body since it touches multiple rows.)
  when others then
    return n;
end $fn$;

-- Service-role/cron only — no caller-supplied input, batch mutation across all users.
revoke all on function sweep_loop_terminus() from public, anon, authenticated;

-- ============================================================================
-- flag_no_show(p_actor, p_lock, p_idem_key): EITHER lock party flags a no-show.
-- ============================================================================
-- DEFINER + auth.uid() re-check + MEMBERSHIP predicate (creator OR matched) — DIFFERENT from
-- the creator-only E6/E7 RPCs (Pitfall 5 / D-01). Idempotent via the transition ledger;
-- serialized on the instance via the advisory lock. Sets locks.status='no_show' ONLY.
create or replace function flag_no_show(p_actor uuid, p_lock uuid, p_idem_key uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare
  cre uuid;
  matched uuid;
  inst uuid;
  lst lock_status;
  prior jsonb;
begin
  -- 1. auth re-check (C10) — the actor must be the caller.
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- 2. idempotency replay (jobs/clients may retry).
  prior := match_idem_lookup(p_actor, 'flag_no_show', p_idem_key);
  if prior is not null then return; end if;

  -- 3. load the lock under a row lock; null-check first so a missing lock is a clear error.
  select creator_id, matched_user_id, date_instance_id, status
    into cre, matched, inst, lst
    from locks where id=p_lock for update;
  if cre is null then raise exception 'no_lock' using errcode='P0002'; end if;

  -- 4. MEMBERSHIP auth (Pitfall 5 / D-01): EITHER party may flag, but no outsider.
  if auth.uid() not in (cre, matched) then
    raise exception 'not_member' using errcode='42501';
  end if;

  -- 5. serialize on the instance (consistent with the rest of the match loop).
  perform pg_advisory_xact_lock(match_instance_lock_key(inst));

  -- 6. only an ACTIVE or COMPLETED lock can be flagged a no-show; a cancelled lock can't.
  if lst not in ('active','completed') then
    raise exception 'not_flaggable' using errcode='P0001';
  end if;

  -- 7. set the LOCK-LEVEL no_show signal ONLY. NEVER touch date_instances.status — the
  --    date_match_status enum has no 'no_show' value (Pitfall 1); writing it throws.
  update locks set status='no_show', updated_at=now() where id=p_lock;

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('lock_no_show_flagged', p_actor, 'lock', p_lock, jsonb_build_object('instance', inst));

  perform match_idem_store(p_actor, 'flag_no_show', p_idem_key, jsonb_build_object('ok', true));
end $fn$;

-- Public C2 RPC: auth is enforced inside (auth.uid() re-check + membership). Revoke from
-- public/anon; grant to authenticated.
revoke execute on function flag_no_show(uuid, uuid, uuid) from public, anon;
grant  execute on function flag_no_show(uuid, uuid, uuid) to authenticated;
