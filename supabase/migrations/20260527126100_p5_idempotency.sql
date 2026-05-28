-- 20260527126100_p5_idempotency.sql
-- A.2: transition idempotency ledger. Money-state RPCs (accept_offer, cancel_lock,
-- resolve_reciprocal, ...) consult this BEFORE side-effects to make retries safe.
-- idem_key is uuid (overrides P5 source's text — see Z-A-happy-path-design §2.9).
-- See docs/superpowers/specs/2026-05-27-5b-A-happy-path-design.md §2 (A.2).

create table if not exists transition_idempotency (
  actor       uuid not null,
  action      text not null,                  -- 'shortlist' | 'make_offer' | 'accept_offer' | 'cancel_lock' | 'resolve_reciprocal' | ...
  idem_key    uuid not null,
  result      jsonb not null,                 -- original function's return value, replayed on retry
  created_at  timestamptz not null default now(),
  primary key (actor, action, idem_key)
);
alter table transition_idempotency enable row level security;
-- No policies: service/definer-only. Clients never read this table directly.

-- match_idem_lookup: returns stored result if seen before, else null.
create or replace function match_idem_lookup(p_actor uuid, p_action text, p_key uuid)
returns jsonb language sql stable security definer set search_path=public as $fn$
  select result from transition_idempotency
   where actor = p_actor and action = p_action and idem_key = p_key
$fn$;

-- match_idem_store: records the result (on conflict do nothing — second call wins idempotently)
create or replace function match_idem_store(p_actor uuid, p_action text, p_key uuid, p_result jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  insert into transition_idempotency(actor, action, idem_key, result)
  values (p_actor, p_action, p_key, p_result)
  on conflict (actor, action, idem_key) do nothing;
end $fn$;

revoke execute on function match_idem_lookup(uuid, text, uuid) from public, authenticated;
revoke execute on function match_idem_store(uuid, text, uuid, jsonb) from public, authenticated;
