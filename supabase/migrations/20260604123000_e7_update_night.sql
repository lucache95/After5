-- 20260604123000_e7_update_night.sql
-- Phase 02 (Loop Closure & Host Controls) Wave 2 — E7 update_night (D-05 / D-06).
--
-- update_night(p_actor, p_instance, p_starts_at, p_duration_min, p_venue, p_ambient_sound_id, p_idem_key)
--   DEFINER RPC, CREATOR-ONLY. Lets the host edit starts_at / duration_min / venue / ambient on
--   their OWN night. NULL param = "leave unchanged" (coalesce(p_x, existing)).
--
--   MATERIAL-CHANGE notify (D-05): when a MATERIAL field changes — starts_at OR venue — on a
--   night that already has interested candidates, NOTIFY them via the new 'night_changed'
--   notification. A non-material change (ambient-only or duration-only) dispatches NOTHING.
--
-- Skeleton copied from match_make_offer (DEFINER + auth.uid() re-check P5001 + idempotency
--   replay + pg_advisory_xact_lock + creator-only 42501 + dispatch INSIDE the DEFINER).
-- Field validators copied VERBATIM from post_night (20260602120300_m4_post_night_ambient.sql):
--   venue must be approval_status='live' AND is_active (curated-place gate); ambient must be
--   is_active. duration_min is bounded 30..1440 by the date_instances table CHECK — let the
--   CHECK enforce it (no manual bound here).
--
-- CRITICAL — time_range is a GENERATED column (20260525120300_p0_date_instances.sql):
--   time_range = tstzrange_from_start_duration(starts_at, duration_min) GENERATED ALWAYS STORED.
--   This RPC writes ONLY starts_at / duration_min / venue_id / ambient_sound_id; time_range
--   RECOMPUTES automatically. NEVER write time_range directly (it would raise — cannot insert
--   into a generated column). The ambient column is date_instances.ambient_sound_id uuid (FK),
--   NOT a text URL.
--
-- Security (D-06 / T-02-09..12): SECURITY DEFINER + set search_path=public; auth re-check AND
--   creator-only ownership check (NOT broadened RLS — NO USING(true)); venue/ambient input
--   validation (P0001); dispatch_notification performed INSIDE the DEFINER only; revoke execute
--   from public/anon, grant to authenticated.
--
-- GATED — LOCAL ONLY this phase. Prod apply is owner-approved and batched separately; do NOT
-- db:push this from here. Depends on 20260604120000 (the 'night_changed' enum value).

create or replace function update_night(
  p_actor uuid,
  p_instance uuid,
  p_starts_at timestamptz,
  p_duration_min int,
  p_venue uuid,
  p_ambient_sound_id uuid,
  p_idem_key uuid
)
returns void language plpgsql security definer set search_path=public as $fn$
declare
  cre uuid;
  st  date_match_status;
  old_starts_at timestamptz;
  old_venue uuid;
  v_venue_ok boolean;
  rec record;
  prior jsonb;
begin
  -- 1. C10 auth re-check.
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;

  -- 2. idempotency replay.
  prior := match_idem_lookup(p_actor, 'update_night', p_idem_key);
  if prior is not null then return; end if;

  -- 3. serialize all activity for this instance.
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  -- 4. load OLD values (needed for the material-change comparison) + null/ownership check.
  select creator_id, status, starts_at, venue_id
    into cre, st, old_starts_at, old_venue
    from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;

  -- 5. validate the changed fields (verbatim from post_night). Only validate fields being set.
  --    M1: a pinned venue must be a curated, live place.
  if p_venue is not null then
    select (approval_status = 'live' and is_active) into v_venue_ok from places where id = p_venue;
    if not coalesce(v_venue_ok,false) then
      raise exception 'venue must be a reviewed (live) place to host a dating meetup' using errcode='P0001';
    end if;
  end if;
  --    M4: an ambient pick must be in the active library.
  if p_ambient_sound_id is not null then
    perform 1 from ambient_sounds where id = p_ambient_sound_id and is_active = true;
    if not found then
      raise exception 'ambient sound not found or inactive' using errcode='P0001';
    end if;
  end if;

  -- 6. UPDATE only the provided (non-null) fields via coalesce; NEVER write the GENERATED
  --    time_range — it recomputes from starts_at/duration_min. duration_min bound 30..1440 is
  --    enforced by the table CHECK.
  update date_instances
     set starts_at        = coalesce(p_starts_at, starts_at),
         duration_min     = coalesce(p_duration_min, duration_min),
         venue_id         = coalesce(p_venue, venue_id),
         ambient_sound_id = coalesce(p_ambient_sound_id, ambient_sound_id),
         updated_at       = now()
   where id=p_instance;

  -- 7. MATERIAL-CHANGE guard (D-05): notify interested candidates ONLY when time or venue
  --    actually changed. A NULL param (unchanged) or an ambient/duration-only edit -> no notify.
  if (p_starts_at is not null and p_starts_at <> old_starts_at)
     or (p_venue is not null and p_venue is distinct from old_venue) then
    for rec in
      select candidate_id from queue_entries
       where date_instance_id=p_instance
         and status in ('interested','shortlisted','standby')
    loop
      perform dispatch_notification(rec.candidate_id, 'night_changed',
        jsonb_build_object(
          'date_instance_id', p_instance,
          'dedup_key', 'night_changed:'||p_instance::text||':'||rec.candidate_id::text));
    end loop;
  end if;

  -- 8. analytics.
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('night_updated', p_actor, 'date_instance', p_instance, jsonb_build_object());

  -- 9. record idempotency.
  perform match_idem_store(p_actor, 'update_night', p_idem_key, jsonb_build_object('ok', true));
end $fn$;

-- Public C2 RPC: auth enforced inside (auth.uid() re-check + creator-only). Revoke from
-- public/anon; grant to authenticated only.
revoke execute on function update_night(uuid, uuid, timestamptz, int, uuid, uuid, uuid) from public, anon;
grant  execute on function update_night(uuid, uuid, timestamptz, int, uuid, uuid, uuid) to authenticated;
