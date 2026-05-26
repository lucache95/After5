-- supabase/migrations/20260525123800_p2_feature_config.sql
-- feature_config + offer_expires_at() (INTEGRATION-CONTRACT C11.1). Owned by P2
-- (band 123800) because P5 (band 126xxx) depends on these. P5's match_make_offer
-- uses offer_expires_at() — no hardcoded 24h (CV8).
-- Clamp 12-72h, DST-safe via make_interval.

create table if not exists feature_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into feature_config(key,value) values ('offer_window_hours','24'::jsonb) on conflict do nothing;

-- coalesce(..., 24): if the offer_window_hours row is ever missing (admin error,
-- or a direct call by a role RLS-blocks from reading feature_config), fall back to the
-- documented 24h default rather than returning NULL — a NULL expiry would make P5 store
-- a never-expiring offer with no valid offer_expiry run_after.
create or replace function offer_expires_at(p_from timestamptz default now()) returns timestamptz
language sql stable as $$
  select p_from + make_interval(hours =>
    greatest(12, least(72, coalesce(
      (select (value#>>'{}')::int from feature_config where key='offer_window_hours'), 24))) )
$$;
-- Internal helper: callers are the P5 SECURITY DEFINER RPCs (run as owner, can read
-- feature_config). Keep it off the public API surface (C10).
revoke execute on function offer_expires_at(timestamptz) from public, authenticated;

alter table feature_config enable row level security;
-- service-role + admin writes only (admin RLS added by P8/S9); no anon/authenticated access by default.
