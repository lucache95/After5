-- wait01: referral-aware waitlist on the existing subscribers table.
--
-- The Sept-8 launch waitlist (see .planning/2026-06-20-kelowna-launch-plan.md)
-- needs a viral referral loop: each signup gets a shareable code, and referrals
-- pull them up the line. subscribers already holds email + source + created_at +
-- email_opt_out + welcome_sent_at; this adds the two referral columns and a
-- read-only status RPC. Additive + idempotent.

alter table subscribers
  add column if not exists referral_code text,
  add column if not exists referred_by  text;

-- referral_code is globally unique when present (the share link key).
create unique index if not exists subscribers_referral_code_key
  on subscribers (referral_code) where referral_code is not null;

-- Fast "who did this code refer" lookups for the position math.
create index if not exists subscribers_referred_by_idx
  on subscribers (referred_by) where referred_by is not null;

-- waitlist_status(code): the caller's own position + referral count, by code.
-- Position = (# joined before you) + 1, minus 1 per confirmed referral (referrals
-- move you up). SECURITY DEFINER so the public client can read its own standing
-- without exposing other rows / emails. Scoped to source='waitlist'.
create or replace function waitlist_status(p_code text)
returns table (queue_position integer, referral_count integer, total integer)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select created_at
    from subscribers
    where referral_code = p_code and source = 'waitlist'
    limit 1
  ),
  ahead as (
    select count(*)::int as n
    from subscribers s, me
    where s.source = 'waitlist' and s.created_at < me.created_at
  ),
  refs as (
    select count(*)::int as n
    from subscribers
    where referred_by = p_code and source = 'waitlist'
  ),
  tot as (
    select count(*)::int as n from subscribers where source = 'waitlist'
  )
  select
    greatest(1, (select n from ahead) + 1 - (select n from refs)) as queue_position,
    (select n from refs) as referral_count,
    (select n from tot)  as total
  -- only return a row when the code actually exists
  where exists (select 1 from me);
$$;

revoke all on function waitlist_status(text) from public;
grant execute on function waitlist_status(text) to anon, authenticated;
