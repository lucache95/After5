-- 7-cleanup.sql — wipe smoke-scoped rows in FK order. Service_role. Idempotent.
-- Variables to substitute:
--   :inst, :host_uid, :cand_uid, :smoke_started_at
--
-- auth.users rows are left dormant; tagged by the `lucas+smoke-…` email pattern.
-- Re-runs of the smoke MUST use a fresh `+suffix-N` because Supabase Auth
-- blocks re-signup on existing emails.

-- 1. ratings + locks (child rows of locks/date_instance)
delete from public.match_ratings
  where lock_id in (select id from public.locks where date_instance_id = :'inst'::uuid);
delete from public.lock_participants
  where lock_id in (select id from public.locks where date_instance_id = :'inst'::uuid);
delete from public.locks
  where date_instance_id = :'inst'::uuid;

-- 2. offers + queue_entries (child rows of date_instance)
delete from public.offers
  where date_instance_id = :'inst'::uuid;
delete from public.queue_entries
  where date_instance_id = :'inst'::uuid;

-- 3. jobs created during the smoke targeting the smoke instance/lock/offer
delete from public.jobs
  where created_at > :'smoke_started_at'::timestamptz
    and (
      payload->>'instance' = :'inst'
      or payload->>'lock_id' in (select id::text from public.locks where date_instance_id = :'inst'::uuid)
      or payload->>'offer_id' in (select id::text from public.offers where date_instance_id = :'inst'::uuid)
    );

-- 4. notifications + analytics for the two smoke users, scoped to the smoke window
delete from public.notifications
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
    and created_at > :'smoke_started_at'::timestamptz;
delete from public.analytics_events
  where actor_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
    and created_at > :'smoke_started_at'::timestamptz;

-- 5. the seeded date itself
delete from public.date_instances
  where id = :'inst'::uuid;

-- 6. smoke profile rows + private + verifications (auth.users untouched)
delete from public.verifications
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid);
delete from public.profiles_private
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid);
delete from public.profiles
  where id in (:'host_uid'::uuid, :'cand_uid'::uuid);
