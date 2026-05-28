-- 20260527126600_p5_profiles_revealed_policy.sql
-- A.7: profiles_select_revealed RLS policy (the PII gate).
--
-- CROSS-BAND OWNERSHIP NOTE: This P5-band migration modifies S1's profiles RLS surface.
-- The intent is canonical:
--   - The reveal predicate (match_reveal_allowed, A.6) is a P5 artifact — it knows about
--     offers/locks/queue_entries, all of which are P5/S5 owned.
--   - The RLS policy that gates profile reads on this predicate is therefore canonically
--     a P5 deliverable, even though the table lives in S1.
--   - S1's pre-existing profiles policies are unmodified; this migration ADDS a parallel
--     policy that opens additional rows when the predicate returns true.
--
-- RESIDUAL COLUMN-LEAK RISK (documented, accepted for 5b):
-- The policy grants row access when reveal-allowed. A caller in a reveal relationship
-- COULD `SELECT email FROM profiles WHERE id=<peer>` and exfiltrate non-Tier-3 fields.
-- Column-level REVOKE doesn't compose with Supabase's table-level grants without
-- breaking S1's existing read paths (public_profile_card view, owner-self reads via
-- RPCs). Mitigations layered above the policy:
--   1. F's reveal modal (the canonical read path) SELECTs only Tier-3 columns.
--   2. C's Edge Functions can project columns server-side before responding.
--   3. The relationship-gated access scope is narrow: only counterparties in a
--      shared offer/lock can probe, and they already know each other through that
--      relationship. Risk is bounded to "what your match has access to," not
--      "what any authenticated user has access to."
-- Phase 7 / S10 may revisit with a dedicated `profiles_revealed_view` for stricter
-- column projection.

-- 1. SECURITY DEFINER helper to evaluate the bidirectional reveal check.
-- Must be DEFINER because the EXISTS clauses read date_instances/offers/locks/
-- lock_participants — all of which have their own RLS that would otherwise hide
-- rows from non-owners (a candidate doesn't own the creator's date_instances row).
-- DEFINER bypasses RLS on those reads while returning only a single boolean.
create or replace function match_reveal_allowed_pair(p_viewer uuid, p_target uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select
    -- (a) viewer is creator of SOME instance; target is candidate or lock participant on it
    exists (
      select 1 from date_instances di
       where di.creator_id = p_viewer
         and (
           exists (select 1 from offers o
                    where o.date_instance_id = di.id
                      and o.candidate_id = p_target
                      and o.status in ('active','accepted'))
           OR exists (select 1 from lock_participants lp
                       join locks l on l.id = lp.lock_id
                       where l.date_instance_id = di.id
                         and l.status in ('active','completed')
                         and lp.user_id = p_target)
         )
    )
    -- (b) target is creator of SOME instance; viewer is candidate or lock participant on it
    OR exists (
      select 1 from date_instances di
       where di.creator_id = p_target
         and (
           exists (select 1 from offers o
                    where o.date_instance_id = di.id
                      and o.candidate_id = p_viewer
                      and o.status in ('active','accepted'))
           OR exists (select 1 from lock_participants lp
                       join locks l on l.id = lp.lock_id
                       where l.date_instance_id = di.id
                         and l.status in ('active','completed')
                         and lp.user_id = p_viewer)
         )
    )
$fn$;

-- 2. RLS policy — symmetric reveal via the DEFINER helper.

drop policy if exists profiles_select_revealed on public.profiles;
create policy profiles_select_revealed
  on public.profiles
  for select
  to authenticated
  using (
    -- Always allow self (defense-in-depth; profiles_owner_all already grants this)
    id = auth.uid()
    OR
    -- Symmetric reveal predicate (uses SECURITY DEFINER helper to bypass dependent-table RLS)
    match_reveal_allowed_pair(auth.uid(), id)
  );

-- 3. NO column-level REVOKE — see RESIDUAL COLUMN-LEAK RISK note at top of file.
-- Column projection is enforced at F's modal and C's Edge Function layer.
