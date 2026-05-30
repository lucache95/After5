-- 20260527127700_p5_reveal_hardening.sql
-- 5b pre-launch reveal hardening — TWO fixes, behind the OFF match_v2_enabled flag.
--
-- #27 — revoke anon/PUBLIC EXECUTE on the two SECURITY DEFINER reveal *helpers*.
--   match_host_can_see_candidate(uuid,uuid)            (127400)
--   match_offer_recipient_can_see_instance(uuid,uuid)  (127500)
-- Both were created with the implicit PUBLIC grant, so anon inherits EXECUTE
-- (security advisor WARN: anon_security_definer_function_executable; an anon call
-- crashed the DB into ~1s recovery). These are RLS-predicate helpers invoked as the
-- querying role — `authenticated` must KEEP EXECUTE; only public/anon is stripped.
-- match_reveal_allowed (126500) and match_reveal_allowed_pair (126600) were checked
-- on the live DB: has_function_privilege('anon', ...) = false (already stripped by
-- 126650/127600), so no REVOKE is needed for them here.
--
-- #28 — reveal predicates must respect offer expiry.
-- The active-offer branch was `o.status in ('active','accepted')`. An offer past
-- expires_at but not yet flipped to 'expired' by the async job still revealed.
-- Change every active-offer branch to:
--   (o.status = 'accepted' OR (o.status = 'active' AND o.expires_at > now()))
-- 'accepted' stays revealed unconditionally (a lock exists); only pending/active is
-- expiry-gated. Applied in match_reveal_allowed (1 spot), match_reveal_allowed_pair
-- (2 spots, both directions), match_offer_recipient_can_see_instance (1 spot).
-- The 'accepted' and lock branches (l.status in ('active','completed')) are unchanged.
-- offers.expires_at is a NOT-NULL-on-active timestamptz column (used by E's countdown).

-- ---------------------------------------------------------------------------
-- #27 — REVOKE anon/PUBLIC EXECUTE on the two helpers (keep authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.match_host_can_see_candidate(uuid, uuid) from public;
revoke execute on function public.match_host_can_see_candidate(uuid, uuid) from anon;
revoke execute on function public.match_offer_recipient_can_see_instance(uuid, uuid) from public;
revoke execute on function public.match_offer_recipient_can_see_instance(uuid, uuid) from anon;

-- ---------------------------------------------------------------------------
-- #28 — expiry-gate the active-offer branch in the three reveal predicates
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_reveal_allowed(p_viewer uuid, p_instance uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    -- Case 1: creator of the instance always sees their offered candidates
    exists (
      select 1 from date_instances di
       where di.id = p_instance and di.creator_id = p_viewer
    )
    -- Case 2: candidate of an accepted offer, or a still-live active offer, on this instance
    or exists (
      select 1 from offers o
       where o.date_instance_id = p_instance
         and o.candidate_id = p_viewer
         and (o.status = 'accepted' OR (o.status = 'active' AND o.expires_at > now()))
    )
    -- Case 3: lock participant on this instance (active or completed lock)
    or exists (
      select 1 from lock_participants lp
       join locks l on l.id = lp.lock_id
       where l.date_instance_id = p_instance
         and l.status in ('active','completed')
         and lp.user_id = p_viewer
    )
$function$;

CREATE OR REPLACE FUNCTION public.match_reveal_allowed_pair(p_viewer uuid, p_target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    -- (a) viewer is creator of SOME instance; target is candidate or lock participant on it
    exists (
      select 1 from date_instances di
       where di.creator_id = p_viewer
         and (
           exists (select 1 from offers o
                    where o.date_instance_id = di.id
                      and o.candidate_id = p_target
                      and (o.status = 'accepted' OR (o.status = 'active' AND o.expires_at > now())))
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
                      and (o.status = 'accepted' OR (o.status = 'active' AND o.expires_at > now())))
           OR exists (select 1 from lock_participants lp
                       join locks l on l.id = lp.lock_id
                       where l.date_instance_id = di.id
                         and l.status in ('active','completed')
                         and lp.user_id = p_viewer)
         )
    )
$function$;

CREATE OR REPLACE FUNCTION public.match_offer_recipient_can_see_instance(p_viewer uuid, p_instance uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    -- Offer stage: viewer is the candidate of an accepted offer, or a still-live active
    -- offer (past expires_at but not yet job-flipped no longer reveals), on this instance.
    exists (
      select 1 from offers o
       where o.date_instance_id = p_instance
         and o.candidate_id = p_viewer
         and (o.status = 'accepted' OR (o.status = 'active' AND o.expires_at > now()))
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
$function$;
