-- Add notifications / queue_entries / locks to the supabase_realtime publication.
--
-- The app already subscribes to INSERTs on all three (subscribeNotifications,
-- subscribeQueueInserts, subscribeLockInserts), but only `messages` was ever
-- published (20260601100500) — so those sockets delivered NOTHING live and the
-- surfaces (notification badge/toast, host interested-list, lock confirmation)
-- were reload/poll-only. This publishes the missing tables so live delivery works.
--
-- Safe by RLS: realtime postgres_changes respects each table's SELECT policy, and
-- all three are recipient-scoped on auth.uid():
--   notifications.notifications_recipient_read  user_id = auth.uid()
--   queue_entries.queue_creator_read / _candidate_read_own  creator/candidate = auth.uid()
--   locks.locks_party_read  creator_id = auth.uid() OR matched_user_id = auth.uid()
-- The socket now carries the viewer JWT (client joinAuthed fix), so the authorizer
-- only streams a row to users who may SELECT it. Subscriptions are INSERT-only, so
-- the default replica identity (PK) is sufficient — no REPLICA IDENTITY FULL needed.
--
-- Idempotent: guard for a missing publication and for tables already present.
do $$
declare
  t text;
begin
  foreach t in array array['notifications','queue_entries','locks']
  loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
      begin
        execute format('alter publication supabase_realtime add table %I', t);
      exception when duplicate_object then null;
      end;
    else
      execute format('create publication supabase_realtime for table %I', t);
    end if;
  end loop;
end $$;
