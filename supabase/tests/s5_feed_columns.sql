-- supabase/tests/s5_feed_columns.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE n int;
BEGIN
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='date_instances'
     and column_name in ('moderation_status','is_seed');
  IF n <> 2 THEN RAISE EXCEPTION 'expected moderation_status + is_seed on date_instances, found %', n; END IF;
  RAISE NOTICE 's5_feed_columns OK';
  ROLLBACK;
END $$;
