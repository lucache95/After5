-- supabase/tests/m35_custom_venue_submissions.sql
-- M3.5: the custom-venue promotion queue. A host who adds a real venue we don't
-- carry records it here (owner-insert / owner-read; admins read via service-role
-- which bypasses RLS). Verifies:
--   1. table exists + RLS enabled
--   2. an owner can insert + read their own row
--   3. a different authenticated user sees ZERO of the owner's rows (negative)
--   4. no permissive write policy with qual = 'true' (never using(true) on writes)
\i supabase/tests/_fixtures.sql
DO $$
DECLARE owner_id uuid; other uuid; itin uuid; n int; rls boolean;
BEGIN
  owner_id := mk_user('m35_owner'); other := mk_user('m35_other');
  itin := mk_itinerary(owner_id);

  -- table exists + RLS enabled
  SELECT relrowsecurity INTO rls FROM pg_class WHERE relname = 'custom_venue_submissions';
  IF rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M3.5a: custom_venue_submissions missing or RLS not enabled (rls=%)', rls;
  END IF;
  RAISE NOTICE 'M3.5a: table exists + RLS enabled OK';

  -- owner inserts + reads their own row
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', owner_id::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO custom_venue_submissions(submitted_by, itinerary_id, google_place_id, name, lat, lng, raw)
    VALUES (owner_id, itin, 'g-abc', 'quiet coffee', 49.88, -119.49, '{"id":"g-abc"}'::jsonb);
  SELECT count(*) INTO n FROM custom_venue_submissions WHERE submitted_by = owner_id;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'M3.5b: owner should insert+read own row (saw %)', n; END IF;
  RAISE NOTICE 'M3.5b: owner inserts + reads own row OK';

  -- a different authenticated user sees zero of the owner's rows
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM custom_venue_submissions WHERE submitted_by = owner_id;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'M3.5c: other user must NOT see owner rows (saw %)', n; END IF;
  RAISE NOTICE 'M3.5c: non-owner sees zero rows OK';

  -- a non-owner cannot insert a row attributed to someone else (with check enforced)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', other::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO custom_venue_submissions(submitted_by, name) VALUES (owner_id, 'spoof');
    RESET ROLE;
    RAISE EXCEPTION 'M3.5d: non-owner insert as owner should have been blocked';
  EXCEPTION WHEN sqlstate '42501' THEN RESET ROLE; RAISE NOTICE 'M3.5d: with-check blocks spoofed submitted_by OK';
  END;

  -- no permissive write (ALL/INSERT/UPDATE/DELETE) policy with qual/with_check = 'true'
  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'custom_venue_submissions'
     AND permissive = 'PERMISSIVE'
     AND cmd IN ('ALL','INSERT','UPDATE','DELETE')
     AND (qual = 'true' OR with_check = 'true');
  IF n <> 0 THEN RAISE EXCEPTION 'M3.5e: found % using(true) write policy on custom_venue_submissions', n; END IF;
  RAISE NOTICE 'M3.5e: no using(true) write policy OK';

  RAISE NOTICE 'M3.5: custom_venue_submissions promotion-queue OK';
  ROLLBACK;
END $$;
