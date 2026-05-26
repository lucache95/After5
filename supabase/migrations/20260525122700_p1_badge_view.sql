create or replace view public_profile_card with (security_invoker = true) as
select p.id as profile_id, p.age, p.vibe_tags, p.prompt_answers, p.blurred_photo_url, p.reliability_score,
  (p.verification = 'verified') as badge_verified,
  (p.verification = 'verified' and p.reliability_score is null) as badge_is_new
from profiles p where p.dating_enabled = true;
grant select on public_profile_card to authenticated;
