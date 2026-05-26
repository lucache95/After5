-- supabase/migrations/20260525121100_p0_audit_log.sql
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  entity text not null,
  entity_id uuid not null,
  action text not null,            -- 'insert' | 'status_change'
  old_status text,
  new_status text,
  actor uuid,                      -- auth.uid() when available
  at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on audit_log(entity, entity_id);

create or replace function log_status_transition() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if (tg_op='INSERT') then
    insert into audit_log(entity,entity_id,action,new_status,actor)
    values (tg_table_name, new.id, 'insert', new.status::text, auth.uid());
  elsif (tg_op='UPDATE' and new.status is distinct from old.status) then
    insert into audit_log(entity,entity_id,action,old_status,new_status,actor)
    values (tg_table_name, new.id, 'status_change', old.status::text, new.status::text, auth.uid());
  end if;
  return new;
end $fn$;

create or replace trigger audit_locks after insert or update on locks
  for each row execute function log_status_transition();
create or replace trigger audit_offers after insert or update on offers
  for each row execute function log_status_transition();
create or replace trigger audit_queue after insert or update on queue_entries
  for each row execute function log_status_transition();
create or replace trigger audit_date_instances after insert or update on date_instances
  for each row execute function log_status_transition();

alter table audit_log enable row level security;  -- no policies: admin/service-role read only.
