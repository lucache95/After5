-- drip01: onboarding email drip state on subscribers.
--
-- A 5-step sequence over a new app-user's first 14 days (days 2/4/7/11/14) that
-- teaches lesser-known features to lift early retention (see the launch-readiness
-- spec). NOT named onboarding_step — profiles already has that (the signup wizard
-- enum). Tracked here on subscribers; the daily cron advances it.

alter table subscribers
  add column if not exists drip_step         int not null default 0,
  add column if not exists drip_last_sent_at timestamptz;

-- Only NEW signups should get the drip — mark everyone already on the list as
-- complete so nobody gets a sudden backfilled blast.
update subscribers set drip_step = 5 where drip_step = 0;

-- Supports the daily cron's selection (step gate + welcome age), scoped to the
-- eligible audience (opted-in, non-waitlist).
create index if not exists subscribers_drip_idx
  on subscribers (drip_step, welcome_sent_at)
  where email_opt_out = false and source <> 'waitlist';
