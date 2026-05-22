-- Add feedback_email_sent_at column to saved_plans.
-- Used by the post-date-feedback cron to track which plans already
-- received a "how was your date?" email (prevents double-sends).

alter table saved_plans
  add column if not exists feedback_email_sent_at timestamptz;

-- Index for the cron query: find saved plans where the feedback email
-- hasn't been sent yet (feedback_email_sent_at IS NULL) and the linked
-- itinerary's planned_for_date falls in yesterday's window.
create index if not exists idx_saved_plans_feedback_unsent
  on saved_plans (feedback_email_sent_at)
  where feedback_email_sent_at is null;
