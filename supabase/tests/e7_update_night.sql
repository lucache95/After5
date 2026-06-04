-- supabase/tests/e7_update_night.sql
-- REQ-E7 (D-05 / D-06): update_night — host edits time/duration/venue/ambient on own night.
--   creator edits starts_at                 -> column updates; GENERATED time_range recomputes.
--   MATERIAL change (starts_at OR venue)     -> interested candidates get 'night_changed'.
--   NON-material change (ambient / duration) -> NO 'night_changed' dispatched.
--   invalid venue (not live+active)          -> raises P0001; night unchanged.
--   invalid/inactive ambient                 -> raises P0001.
--   non-creator                              -> raises 42501.
--   NULL params                              -> leave the existing value unchanged.
--
-- Conventions: psql assertions (NOT pgTAP) — \i fixtures, DO blocks, RAISE on failed assert,
-- ROLLBACK per case. auth.uid() set via request.jwt.claims 'sub'. A curated 'live' place is
-- inserted directly (same recipe as s5_post_night.sql); seeded ambient_sounds are active.
\i supabase/tests/_fixtures.sql

-- ============================================================================
-- MATERIAL (time) CHANGE: starts_at edit recomputes time_range AND notifies interested.
-- ============================================================================
DO $$
DECLARE
  cre uuid; c1 uuid; it uuid; inst uuid;
  old_lower timestamptz; new_lower timestamptz; new_starts timestamptz;
BEGIN
  cre := mk_user('e7t_cre'); c1 := mk_user('e7t_c1'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');  -- fixture duration_min=150
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (inst, c1, cre, 'interested');

  SELECT lower(time_range) INTO old_lower FROM date_instances WHERE id=inst;
  new_starts := now() + interval '5 days';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  -- edit ONLY starts_at (material); all other params null = unchanged
  PERFORM update_night(cre, inst, new_starts, null, null, null, gen_random_uuid());

  -- ASSERT: starts_at updated AND the GENERATED time_range recomputed to match.
  SELECT lower(time_range) INTO new_lower FROM date_instances WHERE id=inst;
  IF new_lower = old_lower THEN RAISE EXCEPTION 'E7: time_range did not recompute after starts_at edit'; END IF;
  PERFORM 1 FROM date_instances WHERE id=inst AND starts_at=new_starts
    AND lower(time_range)=new_starts;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: time_range lower bound != new starts_at (GENERATED column wrong)'; END IF;

  -- ASSERT: the interested candidate got a night_changed notification (material change).
  PERFORM 1 FROM notifications WHERE user_id=c1 AND type='night_changed'
    AND payload->>'date_instance_id'=inst::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: material (time) change did not notify interested candidate'; END IF;

  RAISE NOTICE 'E7: material time change OK (time_range recomputed + night_changed dispatched)';
  ROLLBACK;
END $$;

-- ============================================================================
-- MATERIAL (venue) CHANGE: venue edit to a live place notifies interested.
-- ============================================================================
DO $do$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; kel uuid; live_venue uuid;
BEGIN
  cre := mk_user('e7v_cre'); c1 := mk_user('e7v_c1'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (inst, c1, cre, 'interested');

  select id into kel from cities where slug='kelowna';
  insert into places (name, slug, type, price_tier, neighborhood, drive_cluster, is_active, approval_status, city_id, source)
    values ('E7 Live Venue', 'e7-live-venue', 'restaurant', '$$', 'downtown', 'downtown', true, 'live', kel, 'curated')
    returning id into live_venue;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM update_night(cre, inst, null, null, live_venue, null, gen_random_uuid());

  PERFORM 1 FROM date_instances WHERE id=inst AND venue_id=live_venue;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: venue not updated to the live place'; END IF;
  PERFORM 1 FROM notifications WHERE user_id=c1 AND type='night_changed';
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: material (venue) change did not notify interested candidate'; END IF;

  RAISE NOTICE 'E7: material venue change OK (venue updated + night_changed dispatched)';
  ROLLBACK;
END $do$;

-- ============================================================================
-- NON-MATERIAL: an ambient-only edit must NOT dispatch night_changed.
-- ============================================================================
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; amb uuid; notif_count int;
BEGIN
  cre := mk_user('e7a_cre'); c1 := mk_user('e7a_c1'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (inst, c1, cre, 'interested');

  select id into amb from ambient_sounds where is_active = true order by sort_order limit 1;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  -- ambient-only edit (non-material per D-05)
  PERFORM update_night(cre, inst, null, null, null, amb, gen_random_uuid());

  -- ASSERT: ambient updated...
  PERFORM 1 FROM date_instances WHERE id=inst AND ambient_sound_id=amb;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: ambient not updated on ambient-only edit'; END IF;

  -- ...but NO night_changed notification was dispatched.
  SELECT count(*) INTO notif_count FROM notifications WHERE user_id=c1 AND type='night_changed';
  IF notif_count <> 0 THEN
    RAISE EXCEPTION 'E7: ambient-only (non-material) edit wrongly dispatched night_changed (got %)', notif_count;
  END IF;

  RAISE NOTICE 'E7: non-material ambient edit OK (updated, NO notification)';
  ROLLBACK;
END $$;

-- ============================================================================
-- NON-MATERIAL: a duration-only edit must NOT dispatch night_changed.
-- ============================================================================
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; notif_count int;
BEGIN
  cre := mk_user('e7d_cre'); c1 := mk_user('e7d_c1'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');  -- duration_min=150
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (inst, c1, cre, 'interested');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM update_night(cre, inst, null, 120, null, null, gen_random_uuid());  -- duration-only (within 30..1440)

  PERFORM 1 FROM date_instances WHERE id=inst AND duration_min=120;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: duration not updated on duration-only edit'; END IF;

  SELECT count(*) INTO notif_count FROM notifications WHERE user_id=c1 AND type='night_changed';
  IF notif_count <> 0 THEN
    RAISE EXCEPTION 'E7: duration-only (non-material) edit wrongly dispatched night_changed (got %)', notif_count;
  END IF;

  RAISE NOTICE 'E7: non-material duration edit OK (updated, NO notification)';
  ROLLBACK;
END $$;

-- ============================================================================
-- NULL params leave existing values unchanged (and dispatch nothing).
-- ============================================================================
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; orig_starts timestamptz; notif_count int;
BEGIN
  cre := mk_user('e7n_cre'); c1 := mk_user('e7n_c1'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
    values (inst, c1, cre, 'interested');
  SELECT starts_at INTO orig_starts FROM date_instances WHERE id=inst;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  PERFORM update_night(cre, inst, null, null, null, null, gen_random_uuid());  -- no-op edit

  PERFORM 1 FROM date_instances WHERE id=inst AND starts_at=orig_starts AND duration_min=150;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: all-null edit changed existing values'; END IF;
  SELECT count(*) INTO notif_count FROM notifications WHERE user_id=c1 AND type='night_changed';
  IF notif_count <> 0 THEN RAISE EXCEPTION 'E7: all-null edit wrongly dispatched night_changed'; END IF;

  RAISE NOTICE 'E7: all-null edit OK (values unchanged, no notification)';
  ROLLBACK;
END $$;

-- ============================================================================
-- INVALID VENUE: a non-live/non-curated venue is rejected (P0001); night unchanged.
-- ============================================================================
DO $do$
DECLARE cre uuid; it uuid; inst uuid; kel uuid; auto_venue uuid; ok boolean := false;
BEGIN
  cre := mk_user('e7iv_cre'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  select id into kel from cities where slug='kelowna';
  insert into places (name, slug, type, price_tier, neighborhood, drive_cluster, is_active, approval_status, city_id, source)
    values ('E7 Auto Venue', 'e7-auto-venue', 'cafe', '$$', 'downtown', 'downtown', true, 'auto', kel, 'discovered')
    returning id into auto_venue;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  BEGIN
    PERFORM update_night(cre, inst, null, null, auto_venue, null, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P0001' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E7: invalid venue expected P0001, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E7: an auto/non-live venue must raise P0001'; END IF;

  PERFORM 1 FROM date_instances WHERE id=inst AND venue_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: rejected invalid-venue edit still mutated the night'; END IF;

  RAISE NOTICE 'E7: invalid venue rejected (P0001) OK';
  ROLLBACK;
END $do$;

-- ============================================================================
-- INVALID AMBIENT: an inactive ambient id is rejected (P0001).
-- ============================================================================
DO $$
DECLARE cre uuid; it uuid; inst uuid; bad_amb uuid := gen_random_uuid(); ok boolean := false;
BEGIN
  cre := mk_user('e7ia_cre'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cre::text)::text, true);
  BEGIN
    PERFORM update_night(cre, inst, null, null, null, bad_amb, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate 'P0001' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E7: invalid ambient expected P0001, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E7: an unknown/inactive ambient must raise P0001'; END IF;

  RAISE NOTICE 'E7: invalid ambient rejected (P0001) OK';
  ROLLBACK;
END $$;

-- ============================================================================
-- NON-CREATOR: a stranger editing the night is rejected (42501); night unchanged.
-- ============================================================================
DO $$
DECLARE cre uuid; stranger uuid; it uuid; inst uuid; orig_starts timestamptz; ok boolean := false;
BEGIN
  cre := mk_user('e7x_cre'); stranger := mk_user('e7x_stranger'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() + interval '3 days');
  SELECT starts_at INTO orig_starts FROM date_instances WHERE id=inst;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', stranger::text)::text, true);
  BEGIN
    PERFORM update_night(stranger, inst, now() + interval '9 days', null, null, null, gen_random_uuid());
  EXCEPTION
    WHEN sqlstate '42501' THEN ok := true;
    WHEN others THEN RAISE EXCEPTION 'E7: non-creator expected 42501, got %/%', sqlstate, sqlerrm;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E7: non-creator edit must raise 42501'; END IF;

  PERFORM 1 FROM date_instances WHERE id=inst AND starts_at=orig_starts;
  IF NOT FOUND THEN RAISE EXCEPTION 'E7: rejected non-creator edit still mutated the night'; END IF;

  RAISE NOTICE 'E7: non-creator rejected (42501) OK';
  ROLLBACK;
END $$;

DO $$ BEGIN RAISE NOTICE 'e7_update_night: all E7 assertions OK'; END $$;
