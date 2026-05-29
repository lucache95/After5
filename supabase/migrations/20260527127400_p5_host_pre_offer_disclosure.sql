-- 20260527127400_p5_host_pre_offer_disclosure.sql
-- 5b-D fix: host can read PRE-OFFER candidate Tier-3 on the interested screen.
--
-- E2E-found (2026-05-29): on /dates/[slug]/interested the date creator reads all their
-- queue_entries rows but only ~1 of N candidate PROFILES — the rest render as "someone".
-- ROOT CAUSE: profiles_select_revealed (126600) gates profile reads on
-- match_reveal_allowed_pair, which only returns true for the offer/lock stage
-- (offers.status in active/accepted, or active/completed locks). A right-swiper sitting
-- at queue_entries.status='interested' (or 'shortlisted'/'standby') has NO offer yet, so
-- the creator cannot read their profile. Only the single offer_active candidate was
-- visible — hence "1 of N". This defeats the host triage screen, whose entire purpose is
-- to let the host see + rank the people who right-swiped their date.
--
-- FIX: an ADDITIVE, SELECT-only policy that grants a date creator read of a profile when
-- that profile is a candidate on a queue_entries row for an instance the creator owns,
-- in any pre/active queue stage. This is the host side only (creator -> candidate); the
-- offer/lock symmetric reveal stays owned by 126600.
--
-- DISCLOSURE-CONSENT NOTE — why NOT gated on swiper_disclosed_at:
--   swiper_disclosed_at is set by match_shortlist (126200), i.e. only once the host
--   SHORTLISTS a candidate. It is NULL for status='interested' candidates. The interested
--   screen must show interested candidates (that is the whole feature), so gating on
--   swiper_disclosed_at is not null would re-create the exact bug. Disclosure consent here
--   is implicit and correct: a candidate right-swiped THIS host's date, which is the act of
--   volunteering their profile to that host for triage. The grant is scoped to instances the
--   creator owns and to candidates who chose to swipe in.
--
-- RESIDUAL COLUMN-LEAK RISK (same class as A.7 / 126600, accepted for 5b — NOT expanded):
--   RLS is row-level. Once a candidate's profiles row is visible to the host, the host could
--   `SELECT email FROM profiles WHERE id=<candidate>` and read non-Tier-3 columns. The app's
--   InterestedList projects only Tier-3 (first_name, age, city, clear_photo_url). The access
--   scope is narrow and relationship-gated: only the creator of the instance the candidate
--   swiped into can probe, and the candidate opted into that relationship by swiping. This is
--   the same bounded risk class A.7 already documents (a future profiles_revealed_view in
--   Phase 7 / S10 may add strict column projection). This migration does NOT change the risk
--   posture — it widens the relationship set from offer/lock to the creator's own queue, all
--   of which are the host's own instances.

-- 1. SECURITY DEFINER helper. DEFINER is REQUIRED: the EXISTS reads queue_entries and
-- date_instances, both of which have their own RLS. Querying them directly inside a
-- profiles RLS policy would either recurse (queue_entries policies read auth.uid()) or
-- silently hide rows. DEFINER bypasses RLS on those reads and returns only a boolean.
-- Scope is intentionally narrow: the viewer must be the OWNER (creator_id) of the
-- instance, and the candidate must hold a queue_entries row in a pre/active stage.
create or replace function match_host_can_see_candidate(p_viewer uuid, p_candidate uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select exists (
    select 1
      from queue_entries qe
      join date_instances di on di.id = qe.date_instance_id
     where di.creator_id = p_viewer
       and qe.candidate_id = p_candidate
       and qe.status in ('interested','shortlisted','standby','offer_active')
  )
$fn$;

-- match_host_can_see_candidate is consumed by the RLS policy below. Like
-- match_reveal_allowed_pair, leave it executable by authenticated: passing arbitrary args
-- returns a bool only (no PII), and the caller would already need to be a creator with a
-- matching queue row for it to return true.

-- 2. ADDITIVE RLS policy — host reads pre-offer queued candidates.
-- Separate, clearly-named policy (NOT folded into profiles_select_revealed) so the host
-- triage grant is independently auditable. PostgreSQL ORs multiple permissive SELECT
-- policies, so this only ever OPENS rows; it cannot revoke 126600's offer/lock reveal.
drop policy if exists profiles_select_host_queue on public.profiles;
create policy profiles_select_host_queue
  on public.profiles
  for select
  to authenticated
  using (
    match_host_can_see_candidate(auth.uid(), id)
  );

-- 3. NO column-level REVOKE — see RESIDUAL COLUMN-LEAK RISK note above. Same posture as A.7.
-- SELECT-only. This migration does NOT add/alter any insert/update/delete policy.
