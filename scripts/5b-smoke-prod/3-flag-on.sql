-- 3-flag-on.sql — flip match_v2_enabled true (service_role).
update public.feature_config
set value = 'true'::jsonb, updated_at = now()
where key = 'match_v2_enabled'
returning key, value, updated_at;
