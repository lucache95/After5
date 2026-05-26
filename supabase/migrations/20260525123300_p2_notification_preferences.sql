-- supabase/migrations/20260525123300_p2_notification_preferences.sql
-- Per-user consent + quiet-hours (INTEGRATION-CONTRACT C11.8). dispatch_notification
-- reads this in the C1 order (consent → quiet-hours → rate-limit). Safety types
-- (safety_checkin, safety_alert) bypass all of it (C1). Quiet hours are evaluated
-- in the user's city timezone in dispatch_notification (Task 7), not stored-only.

create table if not exists notification_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  -- category toggles (apply to non-safety types)
  offers_enabled boolean not null default true,        -- offer_received/offer_expiring/standby_promoted
  matches_enabled boolean not null default true,       -- new_match
  messages_enabled boolean not null default true,      -- new_message
  reminders_enabled boolean not null default true,     -- date_reconfirm, rating_request
  account_enabled boolean not null default true,       -- account, moderation_action
  -- quiet hours, local to the user's city tz; safety types bypass these
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger set_notification_preferences_updated_at before update on notification_preferences
  for each row execute function set_updated_at();

alter table notification_preferences enable row level security;
do $$ begin
  create policy "notif_prefs_owner_all" on notification_preferences for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Auto-create a default prefs row on profile creation (dispatch treats a missing
-- row as permissive defaults too, so this is data hygiene, not correctness-load-bearing).
create or replace function ensure_notification_preferences() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $fn$;
do $$ begin
  create trigger profiles_ensure_notif_prefs after insert on profiles
    for each row execute function ensure_notification_preferences();
exception when duplicate_object then null; end $$;
