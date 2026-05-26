-- Add feedback_completed_at column to saved_plans.
-- Used for one-time-use enforcement on feedback tokens: once a user
-- submits post-date feedback, this timestamp is set and subsequent
-- submissions with the same token are rejected.

alter table saved_plans
  add column if not exists feedback_completed_at timestamptz;
