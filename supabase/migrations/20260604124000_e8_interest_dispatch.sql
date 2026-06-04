-- 20260604124000_e8_interest_dispatch.sql
-- REQ-E8 (D-07): wire the demand→supply signal. CREATE OR REPLACE match_ingest_interest
-- so that a right-swipe which adds a GENUINELY NEW interested candidate dispatches
-- `interest_received` to the night's host, deep-linked (via payload.date_instance_id)
-- to that night's /dates/[instance]/interested list.
--
-- WHY the n>0 guard: match_ingest_interest re-runs on EVERY right-swipe (it bulk-seeds
-- queue_entries from all right-swipes with ON CONFLICT DO NOTHING). A naive unconditional
-- dispatch would re-notify the host on every re-ingest/no-op. `get diagnostics n` is the
-- count of rows the insert actually added, so `n > 0` fires the host notification ONLY when
-- a new candidate was enqueued (T-02-14 DoS mitigation).
--
-- WHY no enum migration: `interest_received` is already a valid notification_type
-- (shipped in 20260603120000_gated_inbox_notification_types.sql).
--
-- WHY no consent branch needed: dispatch_notification has no interest_received case in its
-- consent gate, so it falls through permissive — the in-app row ALWAYS surfaces (D-07). Email/
-- push are throttled by the coarse per-instance dedup_key below: dispatch_notification
-- short-circuits a duplicate (type, dedup_key), so a popular night's repeat ingests collapse
-- to one delivery while the grouped inbox row still reflects demand. The per-instance key is
-- the simplest faithful throttle window (digest granularity is Claude's-discretion per D-07).
--
-- SECURITY (T-02-13): the dispatch runs inside this SECURITY DEFINER. match_ingest_interest
-- stays revoked from public+authenticated (it is called only by record_swipe DEFINER). The
-- body below is the 20260527126200_p5_shortlist.sql version VERBATIM; only the dispatch guard
-- after `get diagnostics` is new. NO grant is added (the revoke at the tail re-asserts it).

create or replace function match_ingest_interest(p_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int := 0; cre uuid;
begin
  select creator_id into cre from date_instances where id=p_instance;
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
  select s.date_instance_id, s.swiper_id, s.creator_id, 'interested'
    from swipes s
   where s.date_instance_id=p_instance and s.direction='right'
     -- never enqueue a blocked pair in either direction
     and not exists (select 1 from blocks b where (b.blocker_id=cre and b.blocked_id=s.swiper_id)
                                                or (b.blocker_id=s.swiper_id and b.blocked_id=cre))
  on conflict (date_instance_id, candidate_id) do nothing;
  get diagnostics n = row_count;

  -- E8: notify the host ONLY when a NEW candidate was enqueued (n>0) and the night has a
  -- creator. payload.date_instance_id is the inbox group key (inbox-activity.ts) and the
  -- deep-link source (notif-map.ts -> /dates/[instance]/interested). The coarse per-instance
  -- dedup_key throttles email/push; the grouped in-app row still surfaces every member.
  if n > 0 and cre is not null then
    perform dispatch_notification(cre, 'interest_received',
      jsonb_build_object(
        'date_instance_id', p_instance,
        'new_count', n,
        'dedup_key', 'interest_received:'||p_instance::text));
  end if;

  return n;
end $fn$;

-- Grants UNCHANGED: stays internal (called by record_swipe DEFINER). Re-assert the revoke
-- so a future schema rebaseline can't accidentally grant it (T-02-13).
revoke execute on function match_ingest_interest(uuid) from public, authenticated;
