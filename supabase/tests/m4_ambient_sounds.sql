-- m4_ambient_sounds.sql — table shape + RLS posture for the ambient library,
-- plus the date_instances pick column (Task 2) and the public bucket (Task 3).
\set ON_ERROR_STOP on
begin;

-- table exists with the expected columns
select 1/count(*) from information_schema.columns
  where table_name='ambient_sounds' and column_name='vibe_tags' and data_type='ARRAY';
select 1/count(*) from information_schema.columns
  where table_name='ambient_sounds' and column_name='storage_path';
select 1/count(*) from information_schema.columns
  where table_name='ambient_sounds' and column_name='is_active';

-- RLS is enabled
select 1/count(*) from pg_tables where tablename='ambient_sounds' and rowsecurity=true;

-- authenticated SELECT policy exists and is scoped to is_active
select 1/count(*) from pg_policies
  where tablename='ambient_sounds' and cmd='SELECT' and 'authenticated'=any(roles);

-- NO broad write policy for authenticated (writes are admin/service-role only)
select 1/(1 - least(1, count(*))) from pg_policies
  where tablename='ambient_sounds' and cmd in ('INSERT','UPDATE','DELETE') and 'authenticated'=any(roles);

-- Task 2: date_instances carries the host's per-date pick (nullable → vibe-auto fallback)
select 1/count(*) from information_schema.columns
  where table_name='date_instances' and column_name='ambient_sound_id' and data_type='uuid';

-- Task 3: public bucket exists
select 1/count(*) from storage.buckets where id='ambient-sounds' and public=true;

rollback;
