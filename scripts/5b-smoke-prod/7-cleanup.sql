-- 7-cleanup.sql — wipe smoke-scoped rows in FK order. Service_role. Idempotent.
-- Variables to substitute:
--   :inst, :host_uid, :cand_uid, :smoke_started_at
--
-- Notes:
--   - The smoke creates a host-owned `itineraries` row (NOT NULL FK from
--     date_instances.itinerary_id) — clean it after the date is deleted.
--   - The smoke creates real `swipes` rows (the CAND swipe via 5a UI + the
--     re-trigger of record_swipe) — clean those too.
--   - auth.users are deleted at the end so re-runs of the smoke don't need
--     to bump the +suffix-N for re-signup. (Without this, Supabase Auth
--     blocks re-signup on existing emails — the only reason older runs
--     suggested keeping +suffix-N rolling.)

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

-- 3. swipes by the two smoke users
delete from public.swipes
  where swiper_id in (:'host_uid'::uuid, :'cand_uid'::uuid);

-- 4. jobs created during the smoke targeting the smoke instance/lock/offer.
--    keep_instance covers B-complete cascade jobs (autoclose_creator_conflicts,
--    autowithdraw_user_conflicts) which payload their target instance under
--    "keep_instance" rather than "instance".
delete from public.jobs
  where created_at > :'smoke_started_at'::timestamptz
    and (
      payload->>'instance' = :'inst'
      or payload->>'keep_instance' = :'inst'
      or payload->>'lock_id' in (select id::text from public.locks where date_instance_id = :'inst'::uuid)
      or payload->>'offer_id' in (select id::text from public.offers where date_instance_id = :'inst'::uuid)
    );

-- 5. notifications + analytics for the two smoke users, scoped to the smoke window
delete from public.notifications
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
    and created_at > :'smoke_started_at'::timestamptz;
delete from public.analytics_events
  where actor_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
    and created_at > :'smoke_started_at'::timestamptz;

-- 6. the seeded date instance + its itinerary
delete from public.date_instances
  where id = :'inst'::uuid;
delete from public.itineraries
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
    and (inputs->>'smoke_test')::boolean = true;

-- 7. smoke profile rows + private + verifications
delete from public.verifications
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid);
delete from public.profiles_private
  where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid);
delete from public.profiles
  where id in (:'host_uid'::uuid, :'cand_uid'::uuid);

-- 8. auth.users (last) — frees the +suffix-N emails for re-use on the next run
delete from auth.users
  where id in (:'host_uid'::uuid, :'cand_uid'::uuid);
