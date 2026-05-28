-- 1-seed-profiles.sql — fix up the two smoke profiles AFTER real signup (service_role).
-- Real signup creates auth.users + (via trigger) a profiles row stuck at the age_gate
-- step. This script sets birthdate, age-gate via dating_enabled, verification, photos,
-- and city — everything the match-chain RPCs check before they'll proceed.
--
-- Variables to substitute (the executor pastes the resolved SQL into Supabase MCP):
--   :host_uid, :cand_uid — captured from real signup

-- 1a. Host: birthdate (must exist before dating_enabled flips true; trigger enforces age gate)
insert into public.profiles_private (user_id, birthdate)
values (:'host_uid'::uuid, '1992-04-12')
on conflict (user_id) do update set birthdate = excluded.birthdate;

-- 1b. Host: profile completion fixup
update public.profiles set
  first_name         = 'Maya (smoke host)',
  gender             = 'woman',
  gender_preferences = '{man,woman}'::text[],
  age_pref           = '[25,41)'::int4range,
  primary_city_id    = '06b7bad2-9918-44cf-8d45-b611e053fa27'::uuid,  -- Kelowna (prod)
  distance_pref_km   = 40,
  vibe_tags          = '{cozy,creative,nightlife}'::text[],
  clear_photo_url    = 'https://placeholder.smoke-test/host-clear.jpg',
  blurred_photo_url  = 'https://placeholder.smoke-test/host-blurred.jpg',
  verification       = 'verified',
  dating_enabled     = true,
  onboarding_step    = 'done',
  onboarding_completed_at = now(),
  prompt_answers     = '{"smoke_test": true, "_marker": "smoke-host"}'::jsonb
where id = :'host_uid'::uuid;

-- 2a. Candidate: birthdate
insert into public.profiles_private (user_id, birthdate)
values (:'cand_uid'::uuid, '1995-09-21')
on conflict (user_id) do update set birthdate = excluded.birthdate;

-- 2b. Candidate: profile completion fixup
update public.profiles set
  first_name         = 'Jordan (smoke cand)',
  gender             = 'man',
  gender_preferences = '{woman}'::text[],
  age_pref           = '[28,40)'::int4range,
  primary_city_id    = '06b7bad2-9918-44cf-8d45-b611e053fa27'::uuid,  -- Kelowna (prod)
  distance_pref_km   = 40,
  vibe_tags          = '{nightlife,active,creative}'::text[],
  clear_photo_url    = 'https://placeholder.smoke-test/cand-clear.jpg',
  blurred_photo_url  = 'https://placeholder.smoke-test/cand-blurred.jpg',
  verification       = 'verified',
  dating_enabled     = true,
  onboarding_step    = 'done',
  onboarding_completed_at = now(),
  prompt_answers     = '{"smoke_test": true, "_marker": "smoke-cand"}'::jsonb
where id = :'cand_uid'::uuid;

-- 3. Return a summary so the executor can confirm both rows look right
select
  id, first_name, gender, primary_city_id, dating_enabled, verification,
  onboarding_step, onboarding_completed_at is not null as onboarded
from public.profiles
where id in (:'host_uid'::uuid, :'cand_uid'::uuid)
order by first_name;
