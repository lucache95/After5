-- 20260527127500_p5_offer_recipient_date_read.sql
-- 5b-E fix: an offer RECIPIENT (candidate) can read the date_instances row they're offered.
--
-- E-found: date_instances has only creator-scoped SELECT policies
-- (date_instances_creator_all 120300, date_instances_owner_select 120200, both
-- `creator_id = auth.uid()`). An offer recipient sitting on an active offer cannot read the
-- instance they've been offered, so E's offer screen has no date row to render. This is the
-- same gap-class as the host-disclosure fix (127400): a relationship-gated party needs read
-- of a row the base policy scopes to the creator only.
--
-- FIX: an ADDITIVE, SELECT-only policy granting read of a date_instances row to a viewer who
-- holds an active/accepted offer on that instance as the candidate. To keep the date readable
-- AFTER the lock forms (offer transitions to 'accepted' and a lock row appears — the offer
-- screen flows straight into the matched/locked view), the grant also covers active/completed
-- lock participants on the instance. This mirrors the relationship set already encoded by
-- match_reveal_allowed (126500) for profile reads, minus the creator case (the creator is
-- already covered by 120200/120300, so this policy does not re-grant it).
--
-- WHY SECURITY DEFINER: the predicate reads `offers` and `lock_participants`/`locks`, all of
-- which have their own RLS. Reading them directly inside a date_instances RLS policy would
-- recurse (their policies call auth.uid()) or silently hide rows. DEFINER bypasses RLS on
-- those reads and returns a bare boolean. Scope is narrow and relationship-gated: the viewer
-- must BE the offer candidate, or a participant of a lock, on the specific instance.
--
-- RESIDUAL COLUMN-LEAK RISK (same class as A.7 / 126600 / 127400, accepted for 5b — NOT
-- expanded): RLS is row-level. Once a date_instances row is visible, the viewer can read every
-- column of it (it carries no PII beyond the night's logistics — itinerary_id, city_id,
-- venue_id, starts_at, etc.). The app projects only what the offer screen shows. The access
-- scope is narrow and relationship-gated: only a candidate the creator actually offered (or a
-- locked party) can read the row. This migration does NOT change the column-leak posture; it
-- widens the readable RELATIONSHIP set on date_instances from creator-only to creator + offer
-- recipient + lock participant. SELECT-only; no insert/update/delete policy touched.

-- 1. SECURITY DEFINER predicate. STABLE; set search_path=public. Returns true when the viewer
-- holds an active/accepted offer (as candidate) on the instance, OR is an active/completed
-- lock participant on it. The creator case is intentionally OMITTED (already covered by the
-- existing creator-scoped policies; folding it in here would be redundant).
create or replace function match_offer_recipient_can_see_instance(p_viewer uuid, p_instance uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select
    -- Offer stage: viewer is the candidate of an active or accepted offer on this instance.
    exists (
      select 1 from offers o
       where o.date_instance_id = p_instance
         and o.candidate_id = p_viewer
         and o.status in ('active','accepted')
    )
    -- Lock stage: keep the date readable post-lock. Viewer is a participant of an active or
    -- completed lock on this instance (the offer screen flows into the matched/locked view).
    or exists (
      select 1 from lock_participants lp
       join locks l on l.id = lp.lock_id
       where l.date_instance_id = p_instance
         and l.status in ('active','completed')
         and lp.user_id = p_viewer
    )
$fn$;

-- Consumed by the RLS policy below. Like match_reveal_allowed / match_host_can_see_candidate,
-- leave it executable by authenticated: it returns a bool only (no row data), and a caller
-- would already need to hold the offer/lock for it to return true.

-- 2. ADDITIVE RLS policy — offer recipient (and post-lock party) reads the instance.
-- Separate, clearly-named, SELECT-only policy (NOT folded into the creator policies) so the
-- grant is independently auditable. PostgreSQL ORs multiple permissive SELECT policies, so
-- this only ever OPENS rows; it cannot revoke the creator's read.
drop policy if exists date_instances_select_offer_recipient on public.date_instances;
create policy date_instances_select_offer_recipient
  on public.date_instances
  for select
  to authenticated
  using (
    match_offer_recipient_can_see_instance(auth.uid(), id)
  );

-- 3. SELECT-only. This migration does NOT add/alter any insert/update/delete policy and does
-- not touch date_instances_creator_all / date_instances_owner_select / date_instances_owner_insert.
