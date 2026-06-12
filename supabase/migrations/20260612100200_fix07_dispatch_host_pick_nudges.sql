-- 20260612100200_fix07_dispatch_host_pick_nudges.sql
-- Pushy host-side timer (founder, 2026-06-12): candidates got a clock; hosts
-- could sit on a queue forever. This dispatcher scans seeking nights that
-- start within 72h, have >=1 interested/standby candidate and NO active
-- offer, and nudges the host. Native (type, dedup_key) uniqueness makes it
-- once per night per day — safe to call from the every-minute cron.
-- Internal: no anon/authenticated grants. T-07: DEFINER, pinned search_path.
create or replace function dispatch_host_pick_nudges()
returns int language plpgsql security definer set search_path=public as $fn$
declare r record; n int := 0;
begin
  for r in
    select di.id, di.creator_id, di.starts_at, count(q.candidate_id) as waiting
      from date_instances di
      join queue_entries q on q.date_instance_id = di.id
                          and q.status in ('interested','shortlisted','standby')
     where di.status = 'seeking'
       and di.starts_at > now()
       and di.starts_at <= now() + interval '72 hours'
       and not exists (select 1 from offers o where o.date_instance_id = di.id and o.status = 'active')
     group by di.id, di.creator_id, di.starts_at
  loop
    perform dispatch_notification(r.creator_id, 'host_pick_nudge',
      jsonb_build_object(
        'date_instance_id', r.id,
        'waiting', r.waiting,
        'starts_at', r.starts_at,
        'dedup_key', 'host_pick:' || r.id::text || ':' || to_char(now(), 'YYYY-MM-DD')));
    n := n + 1;
  end loop;
  return n;
end $fn$;
revoke execute on function dispatch_host_pick_nudges() from public;
revoke execute on function dispatch_host_pick_nudges() from anon;
revoke execute on function dispatch_host_pick_nudges() from authenticated;
