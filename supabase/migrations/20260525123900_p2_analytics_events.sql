-- supabase/migrations/20260525123900_p2_analytics_events.sql
-- Append-only analytics outbox (INTEGRATION-CONTRACT C11.8 + C11.12). The table is
-- owned by P2 (band 123900) so P5/P2 can emit. The analytics_relay job handler that
-- drains this to PostHog + 30-day retention purge are P11/S12 (referenced in
-- handlers.ts via analytics_relay_drain). Every C2 transition emits a row here.
--
-- C11.12 frozen column shape:
--   id bigint generated always as identity primary key
--   event_type text not null
--   actor_id uuid                     (nullable for system events)
--   subject_type text
--   subject_id uuid
--   payload jsonb not null default '{}'
--   created_at timestamptz not null default now()
--
-- Writer: emit_analytics(event_type, actor_id, subject_type, subject_id, payload)

create table if not exists analytics_events (
  id          bigint generated always as identity primary key,
  event_type  text not null,
  actor_id    uuid,                         -- user who triggered the event (nullable for system events)
  subject_type text,                        -- e.g. 'offer', 'lock', 'instance'
  subject_id  uuid,                         -- FK to the entity (not enforced; cross-table)
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
-- Drain/retention scans by recency (P11 analytics_relay_drain + >30d purge). Append-only
-- outbox has no "pending" state, so this is a plain created_at index (not partial).
create index if not exists analytics_events_created_idx on analytics_events (created_at);
create index if not exists analytics_events_actor_idx on analytics_events (actor_id) where actor_id is not null;

alter table analytics_events enable row level security;
-- service-role only (emit + drain); no anon/authenticated.

-- emit_analytics(event_type, actor_id, subject_type, subject_id, payload) — C11.12 writer.
-- Called by every C2 transition. Returns the new row id (bigint).
create or replace function emit_analytics(
  p_event_type  text,
  p_actor_id    uuid,
  p_subject_type text default null,
  p_subject_id  uuid default null,
  p_payload     jsonb default '{}'
) returns bigint
language plpgsql security definer set search_path = public as $fn$
declare v_id bigint;
begin
  insert into analytics_events (event_type, actor_id, subject_type, subject_id, payload)
  values (p_event_type, p_actor_id, p_subject_type, p_subject_id, coalesce(p_payload,'{}'))
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function emit_analytics(text, uuid, text, uuid, jsonb) from public, authenticated;
