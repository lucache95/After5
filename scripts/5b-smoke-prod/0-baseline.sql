-- 0-baseline.sql — pre-smoke row-count snapshot (service_role)
-- Capture the output and save into RUN-LOG.md. Used by the post-cleanup
-- check to confirm we leave prod at the same baseline.
select
  (select count(*) from public.profiles)              as profiles,
  (select count(*) from public.profiles_private)      as profiles_private,
  (select count(*) from public.verifications)         as verifications,
  (select count(*) from public.date_instances)        as date_instances,
  (select count(*) from public.swipes)                as swipes,
  (select count(*) from public.queue_entries)         as queue_entries,
  (select count(*) from public.offers)                as offers,
  (select count(*) from public.locks)                 as locks,
  (select count(*) from public.lock_participants)     as lock_participants,
  (select count(*) from public.match_ratings)         as match_ratings,
  (select count(*) from public.notifications)         as notifications,
  (select count(*) from public.jobs)                  as jobs,
  (select count(*) from public.analytics_events)      as analytics_events,
  (select count(*) from public.admin_alerts)          as admin_alerts,
  (select value::boolean from public.feature_config
    where key='match_v2_enabled')                     as match_v2_enabled;
