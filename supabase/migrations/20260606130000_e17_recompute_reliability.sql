-- ============================================================================
-- E17 reliability scoring (REQ-E17)
--
-- recompute_reliability(p_ratee) aggregates the ratee's match_ratings rows plus
-- their no_show locks into a single 0-100 integer percent written to
-- profiles.reliability_score. close_rating_window calls it for BOTH lock parties
-- after stamping rating_closed_at, so a rated user earns a visible reliability
-- signal as soon as the window closes.
--
-- D-01: weighted % of positive outcomes; showed_up heaviest; on_time +
--       cancelled_with_notice contribute; unsafe_or_disrespectful penalizes hard.
--       "new" (score = NULL, badge_is_new) until >= 3 total dates.
-- D-02: SOFT posture. This writes ONLY profiles.reliability_score. NO enforcement,
--       NO lock-status change, NO bans/cooldowns. no_show feeds the score as a
--       missed (0) date and counts toward the >= 3 threshold.
--
-- WEIGHTS mirror packages/business/src/reliability.ts 1:1 (the unit spec):
--   attended date  : showed_up 80 + on_time 20            -> clean date = 100
--   no-show, polite : cancelled_with_notice 50 (recovery credit only when NOT shown)
--   unsafe flag     : -100 (wipes that date's contribution to 0, floored)
--   no_show lock    : 0
-- Average over (distinct rated locks + no_show locks), clamp 0-100, round.
--
-- rated ∩ no_show OVERLAP RULE (RESEARCH Pitfall 4 / Open Q3): no_show is
-- AUTHORITATIVE. A lock counted as no_show is NOT also credited a match_ratings
-- contribution for this ratee — the no_show count EXCLUDES any lock that already
-- has a match_ratings row for p_ratee, so each lock lands in exactly one bucket.
--
-- GATED-PROD-APPLY: local apply + advisor + the SQL assertion script
-- (supabase/tests/e17_recompute_reliability.sql) run in plan 06-05. Do NOT apply
-- to prod (ufufmcpnysvwtutpbian) here.
-- ============================================================================

-- The score is a 0-100 percent. The p0 column was numeric(4,2) (max 99.99), which
-- cannot hold a perfect 100. Widen to numeric(5,2) so a clean record stores 100.00.
-- public_profile_card (20260525122700_p1_badge_view) reads reliability_score, so the
-- column type cannot be altered while the view exists — drop it, widen, recreate it
-- verbatim. Precision-widen only (non-destructive); the recreated view is identical.
drop view if exists public_profile_card;
alter table profiles alter column reliability_score type numeric(5,2);
create or replace view public_profile_card with (security_invoker = true) as
select p.id as profile_id, p.age, p.vibe_tags, p.prompt_answers, p.blurred_photo_url, p.reliability_score,
  (p.verification = 'verified') as badge_verified,
  (p.verification = 'verified' and p.reliability_score is null) as badge_is_new
from profiles p where p.dating_enabled = true;
grant select on public_profile_card to authenticated;

create or replace function recompute_reliability(p_ratee uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare
  n_rated  int;
  n_noshow int;
  sum_rated numeric;   -- summed per-lock score across the ratee's rated locks
  total_dates int;
  raw numeric;
begin
  if p_ratee is null then return; end if;

  -- One contribution per RATED LOCK. A lock may carry ratings from both parties;
  -- collapse to one per-lock score conservatively (bool_or over the signals) so a
  -- single safety flag on a lock counts. Score mirrors reliability.ts scoreDate():
  --   showed_up -> 80 + (on_time -> 20); else cancelled_with_notice -> 50; else 0;
  --   then unsafe_or_disrespectful subtracts 100, floored at 0.
  with per_lock as (
    select
      lock_id,
      bool_or(coalesce(showed_up, false))              as showed_up,
      bool_or(coalesce(on_time, false))                as on_time,
      bool_or(coalesce(cancelled_with_notice, false))  as cancelled_with_notice,
      bool_or(coalesce(unsafe_or_disrespectful, false))as unsafe
    from match_ratings
    where ratee_id = p_ratee
    group by lock_id
  )
  select count(*),
         coalesce(sum(
           greatest(0,
             (case
                when showed_up then 80 + (case when on_time then 20 else 0 end)
                when cancelled_with_notice then 50
                else 0
              end)
             - (case when unsafe then 100 else 0 end)
           )
         ), 0)
    into n_rated, sum_rated
    from per_lock;

  -- no_show locks where the ratee was a party (flag_no_show sets locks.status only,
  -- it writes NO match_ratings row). EXCLUDE any lock already counted as rated above
  -- so a lock never lands in both buckets (no_show authoritative — see overlap rule).
  select count(*) into n_noshow
    from locks l
    where l.status = 'no_show'
      and (l.creator_id = p_ratee or l.matched_user_id = p_ratee)
      and not exists (
        select 1 from match_ratings mr
        where mr.lock_id = l.id and mr.ratee_id = p_ratee
      );

  total_dates := n_rated + n_noshow;

  -- "new" until >= 3 dates: leave score NULL so badge_is_new stays true.
  if total_dates < 3 then
    update profiles set reliability_score = null where id = p_ratee;
    return;
  end if;

  -- Average over all dates: rated-lock scores + zero for each no_show.
  raw := round(sum_rated / total_dates);
  update profiles
    set reliability_score = greatest(0, least(100, raw))
    where id = p_ratee;
end $fn$;

-- service-role / internal only: the score is written ONLY here, never by a client.
revoke all on function recompute_reliability(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- close_rating_window: CREATE OR REPLACE (grants survive). Same body as
-- 20260527127200_p5_job_rpcs_backfill.sql:79-94, plus a recompute for BOTH
-- parties AFTER stamping rating_closed_at. Stale-tolerant + idempotent: a second
-- call no-ops (rating_closed_at already set), so the recompute is not re-run.
-- ----------------------------------------------------------------------------
create or replace function close_rating_window(p_lock uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare existing timestamptz; found_lock boolean; l_creator uuid; l_matched uuid;
begin
  if p_lock is null then return; end if;

  select rating_closed_at, true, creator_id, matched_user_id
    into existing, found_lock, l_creator, l_matched
    from locks where id=p_lock for update;
  if not found_lock then return; end if;        -- stale/nonexistent: drain cleanly
  if existing is not null then return; end if;  -- already closed: idempotent no-op

  update locks set rating_closed_at=now(), updated_at=now() where id=p_lock;

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('match_rating_window_closed', null, 'lock', p_lock, jsonb_build_object());

  -- E17: recompute reliability for both parties now that ratings are final.
  perform recompute_reliability(l_creator);
  perform recompute_reliability(l_matched);
end $fn$;

revoke all on function close_rating_window(uuid) from public, anon, authenticated;
