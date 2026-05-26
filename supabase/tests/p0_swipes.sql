-- supabase/tests/p0_swipes.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='swipes' AND indexdef ILIKE '%unique%swiper_id%date_instance_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'swipes unique(swiper,instance) missing'; END IF;

  -- Regression guard: the insert policy MUST validate creator_id against date_instances,
  -- not just swiper_id = auth.uid(). Otherwise a forged creator_id leaks right-swiper
  -- identities via swipes_visible (blind-browse leak). Assert the subquery is present.
  PERFORM 1 FROM pg_policies
   WHERE tablename='swipes' AND policyname='swipes_swiper_insert'
     AND with_check ILIKE '%date_instances%' AND with_check ILIKE '%creator_id%';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'swipes_swiper_insert must validate creator_id against date_instances';
  END IF;
END $$;
