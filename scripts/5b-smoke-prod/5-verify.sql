-- 5-verify.sql — final-state assertion (service_role). Returns one row.
-- Compare each column against the "expected" annotation. Hard fail: admin_alerts_count > 0.
--
-- Variables to substitute:
--   :inst, :host_uid, :cand_uid, :smoke_started_at
--
-- Notes:
--   - queue_status transitions to 'locked' once the offer is accepted; that's the
--     correct post-accept state for the happy path (NOT 'interested').
--   - reveal verification uses match_reveal_allowed_pair() directly: service_role
--     bypasses RLS, so we can't observe the profiles_select_revealed POLICY by
--     SELECT. The DEFINER predicate gives a definitive boolean per direction.
--   - jobs filter accepts both payload.instance (e.g., rating_window) and
--     payload.keep_instance (B-complete cascades: autoclose_creator_conflicts,
--     autowithdraw_user_conflicts).
select
  (select count(*) from public.queue_entries
    where date_instance_id = :'inst'::uuid)                                                      as queue_entries_count,        -- expect 1
  (select status::text from public.queue_entries
    where date_instance_id = :'inst'::uuid limit 1)                                              as queue_status,               -- expect 'locked' (post-accept; was 'interested' pre-accept)
  (select rank from public.queue_entries
    where date_instance_id = :'inst'::uuid limit 1)                                              as queue_rank,                 -- expect 1
  (select count(*) from public.offers
    where date_instance_id = :'inst'::uuid)                                                      as offers_count,               -- expect 1
  (select status::text from public.offers
    where date_instance_id = :'inst'::uuid limit 1)                                              as offer_status,               -- expect 'accepted'
  (select count(*) from public.locks
    where date_instance_id = :'inst'::uuid)                                                      as locks_count,                -- expect 1
  (select count(*) from public.lock_participants lp
    join public.locks l on l.id = lp.lock_id
    where l.date_instance_id = :'inst'::uuid)                                                    as lock_participants_count,    -- expect 2
  (select count(*) from public.match_ratings mr
    join public.locks l on l.id = mr.lock_id
    where l.date_instance_id = :'inst'::uuid)                                                    as ratings_count,              -- expect 2
  (case when public.match_reveal_allowed_pair(:'host_uid'::uuid, :'cand_uid'::uuid)
         and public.match_reveal_allowed_pair(:'cand_uid'::uuid, :'host_uid'::uuid)
        then 2 else 0 end)                                                                       as reveal_visible_count,       -- expect 2
  (select array_agg(distinct type::text order by type::text)
    from public.notifications
    where user_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
      and created_at > :'smoke_started_at'::timestamptz)                                         as notification_types,         -- expect superset of {offer_received, new_match}
  (select array_agg(distinct event_type order by event_type)
    from public.analytics_events
    where actor_id in (:'host_uid'::uuid, :'cand_uid'::uuid)
      and created_at > :'smoke_started_at'::timestamptz)                                         as analytics_event_types,      -- expect superset of {match_shortlisted, match_offer_made, match_lock_created}
  (select count(*) from public.jobs
    where created_at > :'smoke_started_at'::timestamptz
      and (payload->>'instance' = :'inst'
        or payload->>'keep_instance' = :'inst'
        or payload->>'lock_id' in (select id::text from public.locks where date_instance_id = :'inst'::uuid)))
                                                                                                 as jobs_enqueued,              -- expect >= 3 (rating_window + autoclose + autowithdraw)
  (select count(*) from public.admin_alerts
    where created_at > :'smoke_started_at'::timestamptz)                                         as admin_alerts_count,         -- HARD FAIL if > 0
  (select (value)::boolean from public.feature_config
    where key='match_v2_enabled')                                                                as flag_state;                 -- expect false (only after 6-flag-off)
