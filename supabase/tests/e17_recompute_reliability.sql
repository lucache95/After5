-- supabase/tests/e17_recompute_reliability.sql
-- E17 (REQ-E17): recompute_reliability + close_rating_window reliability hook.
-- SQL assertion script — the project's local-apply verification posture (no pgTAP
-- harness in-tree). RAISE EXCEPTION on any failed assertion so a non-zero psql exit
-- signals failure. EXECUTED in plan 06-05 against the local stack after migrations
-- apply; this file is authored here only.
--
-- Covers:
--   (a) 3 no_show locks, zero match_ratings -> reliability_score = 0 (NOT null;
--       >= 3 dates counted from locks.status, no_show authoritative)
--   (b) 3 positive (showed_up) match_ratings -> high score, NOT NULL
--   (c) < 3 total dates -> reliability_score IS NULL (new member)
--   (d) idempotency: close_rating_window twice on one lock -> no error, stable score
\i supabase/tests/_fixtures.sql

-- A no_show lock between two fresh users on a fresh instance. Returns the lock id.
-- Each call needs its own instance (locks.unique(date_instance_id)).
create or replace function e17_mk_noshow_lock(p_ratee uuid, p_other uuid) returns uuid
language plpgsql as $$
declare itin uuid; inst uuid; lid uuid;
begin
  itin := mk_itinerary(p_other);
  inst := mk_instance(itin, p_other, now() - interval '2 days');
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, p_other, p_ratee, 'no_show') returning id into lid;
  return lid;
end $$;

-- A rated lock: p_other rates p_ratee with the given outcome signals.
create or replace function e17_mk_rated_lock(
  p_ratee uuid, p_other uuid,
  p_showed boolean, p_ontime boolean, p_notice boolean, p_unsafe boolean
) returns uuid
language plpgsql as $$
declare itin uuid; inst uuid; lid uuid;
begin
  itin := mk_itinerary(p_other);
  inst := mk_instance(itin, p_other, now() - interval '2 days');
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, p_other, p_ratee, 'completed') returning id into lid;
  insert into match_ratings (lock_id, rater_id, ratee_id, showed_up, on_time, cancelled_with_notice, unsafe_or_disrespectful)
    values (lid, p_other, p_ratee, p_showed, p_ontime, p_notice, p_unsafe);
  return lid;
end $$;

-- ============================================================================
-- (a) 3 no_show locks, zero ratings -> score = 0, NOT null
-- ============================================================================
DO $$
DECLARE ratee uuid; o1 uuid; o2 uuid; o3 uuid; sc numeric;
BEGIN
  ratee := mk_user('e17a_ratee');
  o1 := mk_user('e17a_o1'); o2 := mk_user('e17a_o2'); o3 := mk_user('e17a_o3');
  PERFORM e17_mk_noshow_lock(ratee, o1);
  PERFORM e17_mk_noshow_lock(ratee, o2);
  PERFORM e17_mk_noshow_lock(ratee, o3);

  PERFORM recompute_reliability(ratee);
  SELECT reliability_score INTO sc FROM profiles WHERE id = ratee;
  IF sc IS NULL THEN
    RAISE EXCEPTION 'E17(a): 3 no_show locks must count as 3 dates (score 0), got NULL (still new)';
  END IF;
  IF sc <> 0 THEN
    RAISE EXCEPTION 'E17(a): 3 no_show locks must score 0, got %', sc;
  END IF;
  RAISE NOTICE 'E17(a) OK: 3 no_show -> score 0';
END $$;

-- ============================================================================
-- (b) 3 positive (showed_up + on_time) ratings -> high score, NOT NULL
-- ============================================================================
DO $$
DECLARE ratee uuid; o1 uuid; o2 uuid; o3 uuid; sc numeric;
BEGIN
  ratee := mk_user('e17b_ratee');
  o1 := mk_user('e17b_o1'); o2 := mk_user('e17b_o2'); o3 := mk_user('e17b_o3');
  PERFORM e17_mk_rated_lock(ratee, o1, true, true, false, false);
  PERFORM e17_mk_rated_lock(ratee, o2, true, true, false, false);
  PERFORM e17_mk_rated_lock(ratee, o3, true, true, false, false);

  PERFORM recompute_reliability(ratee);
  SELECT reliability_score INTO sc FROM profiles WHERE id = ratee;
  IF sc IS NULL THEN
    RAISE EXCEPTION 'E17(b): 3 positive ratings must NOT be NULL (>= 3 established)';
  END IF;
  IF sc < 95 THEN
    RAISE EXCEPTION 'E17(b): 3 all-good ratings must score high (>=95), got %', sc;
  END IF;
  RAISE NOTICE 'E17(b) OK: 3 showed_up -> score % (established)', sc;
END $$;

-- ============================================================================
-- (c) < 3 total dates -> NULL (new member)
-- ============================================================================
DO $$
DECLARE ratee uuid; o1 uuid; o2 uuid; sc numeric;
BEGIN
  ratee := mk_user('e17c_ratee');
  o1 := mk_user('e17c_o1'); o2 := mk_user('e17c_o2');
  PERFORM e17_mk_rated_lock(ratee, o1, true, true, false, false);
  PERFORM e17_mk_noshow_lock(ratee, o2);  -- 2 total dates only

  PERFORM recompute_reliability(ratee);
  SELECT reliability_score INTO sc FROM profiles WHERE id = ratee;
  IF sc IS NOT NULL THEN
    RAISE EXCEPTION 'E17(c): < 3 dates must stay NULL (new member), got %', sc;
  END IF;
  RAISE NOTICE 'E17(c) OK: 2 dates -> NULL (new here)';
END $$;

-- ============================================================================
-- (d) idempotency: close_rating_window twice -> no error + stable score
-- close_rating_window recomputes BOTH parties after stamping rating_closed_at;
-- the second call is an idempotent no-op (rating_closed_at already set).
-- ============================================================================
DO $$
DECLARE ratee uuid; other uuid; itin uuid; inst uuid; lid uuid; sc1 numeric; sc2 numeric;
BEGIN
  ratee := mk_user('e17d_ratee'); other := mk_user('e17d_other');
  -- give the ratee 2 prior rated dates so this lock pushes them to the >= 3 threshold
  PERFORM e17_mk_rated_lock(ratee, mk_user('e17d_p1'), true, true, false, false);
  PERFORM e17_mk_rated_lock(ratee, mk_user('e17d_p2'), true, true, false, false);

  itin := mk_itinerary(other);
  inst := mk_instance(itin, other, now() - interval '2 days');
  insert into locks (date_instance_id, creator_id, matched_user_id, status)
    values (inst, other, ratee, 'completed') returning id into lid;
  insert into match_ratings (lock_id, rater_id, ratee_id, showed_up, on_time, cancelled_with_notice, unsafe_or_disrespectful)
    values (lid, other, ratee, true, true, false, false);

  PERFORM close_rating_window(lid);
  SELECT reliability_score INTO sc1 FROM profiles WHERE id = ratee;
  IF sc1 IS NULL THEN
    RAISE EXCEPTION 'E17(d): close_rating_window must have recomputed the ratee (3 dates), got NULL';
  END IF;

  -- second call: must not raise, must not change the score (idempotent no-op)
  PERFORM close_rating_window(lid);
  SELECT reliability_score INTO sc2 FROM profiles WHERE id = ratee;
  IF sc2 IS DISTINCT FROM sc1 THEN
    RAISE EXCEPTION 'E17(d): double close_rating_window must be stable, got % then %', sc1, sc2;
  END IF;
  RAISE NOTICE 'E17(d) OK: close_rating_window idempotent, score stable at %', sc1;
END $$;

-- cleanup helpers
drop function if exists e17_mk_noshow_lock(uuid, uuid);
drop function if exists e17_mk_rated_lock(uuid, uuid, boolean, boolean, boolean, boolean);
