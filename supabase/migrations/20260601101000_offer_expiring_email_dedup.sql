-- supabase/migrations/20260601101000_offer_expiring_email_dedup.sql
-- Dedup column for the "your offer expires soon" reminder email.
--
-- The web-side cron (/api/cron/offer-expiring) emails the candidate when their
-- still-open offer (status='active') is about to lapse. We stamp this column
-- when the reminder is sent so the cron query can filter
-- `expiring_email_sent_at is null` and never double-send. Idempotent.

alter table offers
  add column if not exists expiring_email_sent_at timestamptz;

comment on column offers.expiring_email_sent_at is
  'Set by the offer-expiring reminder cron when the candidate has been emailed; prevents duplicate reminders.';
