-- 6-flag-off.sql — flip match_v2_enabled back to false (service_role).
-- Run only after the chain has completed AND no halt conditions fired.
-- If a halt fired, do NOT run this; leave the flag on for debugging.
update public.feature_config
set value = 'false'::jsonb, updated_at = now()
where key = 'match_v2_enabled'
returning key, value, updated_at;
