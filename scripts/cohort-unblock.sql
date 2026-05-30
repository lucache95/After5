-- =============================================================================
-- cohort-unblock.sql — tester-cohort onboarding bypass
-- =============================================================================
-- Makes a known set of tester user ids "match-ready" WITHOUT the still-unwired
-- Twilio (phone OTP) and Persona (age/selfie) providers. Per the launch funnel
-- audit (docs/superpowers/reports/2026-05-29-launch-funnel-audit.md), a user
-- can only enter the matching loop when:
--     dating_enabled = true AND verification = 'verified' AND account_state = 'active'
-- and the enforce_age_gate trigger requires a profiles_private.birthdate (18+)
-- BEFORE dating_enabled can flip to true.
--
-- HOW TO RUN (local, service-role / postgres — bypasses RLS):
--     1. Edit the cohort_input CTE below: replace the sample rows with your real
--        tester user ids (uuid from auth.users / profiles.id). City defaults to
--        Kelowna via :city_slug.
--     2. psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--          -v city_slug=kelowna -f scripts/cohort-unblock.sql
--
-- Re-runnable: every write is idempotent (upsert / set). Running twice is safe.
--
-- !! WARNING !!  This bypasses REAL identity verification. It flags phone/age/
-- selfie as verified for arbitrary uids with NO actual SMS or ID check. Use for
-- a closed, trusted tester cohort on a NON-prod database ONLY. Wire Twilio +
-- Persona (and remove reliance on this script) before any public launch. Do NOT
-- run against prod or against real, untrusted users.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- -----------------------------------------------------------------------------
-- EDIT ME: the tester cohort. One row per tester.
-- Defaults to existing LOCAL test users for a safe dry run. Replace user_id
-- values with real tester uids before running for real.
--
-- Columns you may tune per tester:
--   gender              : 'woman' | 'man' | 'nonbinary'
--   gender_preferences  : array of the above (who they want to see)
--   age_pref            : int4range of acceptable partner ages (lower must be 18+)
-- The defaults below are deliberately permissive (everyone matches everyone,
-- ages 18-99) so the cohort is mutually feed-eligible out of the box. The feed
-- RPC (browse_feed_for_viewer) enforces gender + age compatibility BOTH ways,
-- so these MUST be set or a verified tester still sees an empty feed.
-- -----------------------------------------------------------------------------
create temporary table cohort_input (
  user_id            uuid primary key,
  birthdate          date,
  gender             text,
  gender_preferences text[],
  age_pref           int4range
) on commit drop;

insert into cohort_input (user_id, birthdate, gender, gender_preferences, age_pref) values
  -- qa-cand (existing local verified tester)
  ('93393751-95d1-4177-8b16-e38bc2847abd', date '1995-04-20', 'woman',
     array['woman','man','nonbinary'], int4range(18, 99, '[]')),
  -- qa-host (existing local tester)
  ('ed0a04cb-43d7-43e5-9a7c-3ee353ea1228', date '1994-08-15', 'man',
     array['woman','man','nonbinary'], int4range(18, 99, '[]'));

-- -----------------------------------------------------------------------------
-- Resolve the cohort city (default Kelowna) into a temp table the steps below
-- read from. Fails loudly with a readable error if the slug is unknown.
-- -----------------------------------------------------------------------------
create temporary table cohort_city on commit drop as
  select id as city_id from cities where slug = :'city_slug';

do $$
begin
  if not exists (select 1 from cohort_city) then
    raise exception 'cohort-unblock: no city found for the given slug';
  end if;
end $$;

-- =============================================================================
-- STEP 1 — birthdate (18+) into profiles_private. MUST happen BEFORE the
-- dating_enabled flip: enforce_age_gate reads profiles_private.birthdate and
-- raises 'birthdate required' if absent. The birthdate-resync trigger also
-- recomputes profiles.age from this.
-- =============================================================================
insert into profiles_private (user_id, birthdate)
select ci.user_id, ci.birthdate
from cohort_input ci
on conflict (user_id) do update
  set birthdate = excluded.birthdate
where profiles_private.birthdate is distinct from excluded.birthdate;

-- Guard: every tester must now be 18+ (a too-young birthdate would let the
-- resync trigger silently force dating_enabled back to false in step 4).
do $$
declare bad int;
begin
  select count(*) into bad
  from profiles_private pp
  join cohort_input ci on ci.user_id = pp.user_id
  where extract(year from age(pp.birthdate)) < 18;
  if bad > 0 then
    raise exception 'cohort-unblock: % tester(s) under 18 — fix birthdate', bad;
  end if;
end $$;

-- =============================================================================
-- STEP 2 — verification rows: phone + age + selfie all 'verified'.
-- verifications_rollup (AFTER trigger) calls recompute_profile_verification,
-- which sets profiles.verification = 'verified' once phone AND age are verified.
-- (selfie is not read by the rollup but the audit lists it; we set it too so the
-- per-kind state matches a real passed flow.)
-- =============================================================================
insert into verifications (user_id, kind, state, provider, verified_at)
select ci.user_id, k.kind, 'verified'::verification_state,
       'cohort-bypass', now()
from cohort_input ci
cross join (values ('phone'), ('age'), ('selfie')) as k(kind)
on conflict (user_id, kind) do update
  set state        = 'verified'::verification_state,
      provider     = 'cohort-bypass',
      verified_at  = coalesce(verifications.verified_at, now()),
      failure_reason = null;

-- =============================================================================
-- STEP 3 — profile match-readiness flags + city + match prefs.
-- gender / gender_preferences / age_pref are required by browse_feed_for_viewer
-- (mutual compatibility, both directions) — without them the feed stays empty.
-- verification is also force-set here (the rollup already set it, but we make it
-- explicit and idempotent). dating_enabled is set in STEP 4 (after birthdate).
-- =============================================================================
update profiles p
set verification       = 'verified'::verification_state,
    standing           = 'good'::standing_state,
    account_state      = 'active'::account_lifecycle,
    onboarding_step    = 'done',
    onboarding_completed_at = coalesce(p.onboarding_completed_at, now()),
    primary_city_id    = (select city_id from cohort_city),
    gender             = ci.gender,
    gender_preferences = ci.gender_preferences,
    age_pref           = ci.age_pref
from cohort_input ci
where p.id = ci.user_id;

-- =============================================================================
-- STEP 4 — flip dating_enabled = true. Runs LAST so enforce_age_gate sees the
-- birthdate from STEP 1 and the 18+ age. The trigger also stamps profiles.age.
-- =============================================================================
update profiles p
set dating_enabled = true
from cohort_input ci
where p.id = ci.user_id
  and p.dating_enabled is distinct from true;

-- -----------------------------------------------------------------------------
-- Report: before/after state of the cohort.
-- -----------------------------------------------------------------------------
select p.id, p.first_name, p.verification, p.standing, p.account_state,
       p.onboarding_step, p.dating_enabled, p.age, pp.birthdate,
       p.gender, p.gender_preferences, p.age_pref,
       (select string_agg(v.kind || ':' || v.state, ', ' order by v.kind)
          from verifications v where v.user_id = p.id) as verifications
from profiles p
join cohort_input ci on ci.user_id = p.id
left join profiles_private pp on pp.user_id = p.id
order by p.first_name;

commit;
