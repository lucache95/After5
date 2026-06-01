-- supabase/migrations/20260601100500_p7_messages_realtime_publication.sql
-- Stream message inserts to subscribed clients. RLS (messages_party_read) gates
-- delivery so a socket only receives messages in the viewer's own threads.
-- The supabase_realtime publication is created by the platform; guard for both
-- "publication missing" and "table already present".
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table messages;
    exception when duplicate_object then null;
    end;
  else
    create publication supabase_realtime for table messages;
  end if;
end $$;
