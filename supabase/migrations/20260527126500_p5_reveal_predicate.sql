-- 20260527126500_p5_reveal_predicate.sql
-- A.6: match_reveal_allowed predicate. The PII gate's keystone.
-- See docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md §2.6.
--
-- Returns true iff:
--   1. viewer IS the instance's creator, OR
--   2. viewer is candidate of an active OR accepted offer on this instance, OR
--   3. viewer is a participant of an active OR completed lock on this instance.
--
-- Live-derived from offer/lock state → revocation is automatic when state changes
-- (e.g., offer expires; the candidate loses reveal access on the next query).
--
-- This function is consumed by A.7's profiles_select_revealed RLS policy.

create or replace function match_reveal_allowed(p_viewer uuid, p_instance uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select
    -- Case 1: creator of the instance always sees their offered candidates
    exists (
      select 1 from date_instances di
       where di.id = p_instance and di.creator_id = p_viewer
    )
    -- Case 2: candidate of an active or accepted offer on this instance
    or exists (
      select 1 from offers o
       where o.date_instance_id = p_instance
         and o.candidate_id = p_viewer
         and o.status in ('active','accepted')
    )
    -- Case 3: lock participant on this instance (active or completed lock)
    or exists (
      select 1 from lock_participants lp
       join locks l on l.id = lp.lock_id
       where l.date_instance_id = p_instance
         and l.status in ('active','completed')
         and lp.user_id = p_viewer
    )
$fn$;

-- match_reveal_allowed is consumed by RLS policies + UI directly. Keep callable by authenticated.
-- (Security: function is SECURITY DEFINER stable; passing arbitrary args returns bool only,
-- no PII leak. Worst case a caller probes "is X in a lock with Y?" but they would already
-- need the instance UUID.)
