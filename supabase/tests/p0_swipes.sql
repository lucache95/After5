-- supabase/tests/p0_swipes.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_indexes
   WHERE tablename='swipes' AND indexdef ILIKE '%unique%swiper_id%date_instance_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'swipes unique(swiper,instance) missing'; END IF;
END $$;
