-- supabase/migrations/20260620120000_drft01_draft_lifecycle.sql
--
-- ⚠️ GATED — NOT YET APPLIED TO PROD. Apply only via the reviewed batched
-- prod-apply (security advisor after DDL). Local-green first.
--
-- DRFT-01: give the quiet drafts list (/my-nights) a lifecycle.
--   • delete_draft_itinerary(id)  — owner deletes a never-posted draft.
--   • clone_itinerary_as_draft(id) — copy any owned itinerary (e.g. behind an
--     expired night) into a fresh, private, un-posted draft to edit + re-post.
--
-- Both mirror create_blank_itinerary's secure-by-default posture: security
-- definer, search_path pinned, auth required, anon revoked, owner-scoped via
-- auth.uid(). Error codes match the host-copy mapping in NightCardActions
-- (42501 = not yours, P0002 = gone, P0001 = specific message).

-- ── delete_draft_itinerary ────────────────────────────────────────────
-- Hard-delete a DRAFT the caller owns. A "draft" is an itinerary with NO
-- date_instance — so this refuses to touch a posted night. That guard is
-- load-bearing: date_instances.itinerary_id is ON DELETE CASCADE, so deleting
-- a posted itinerary here would silently wipe the live night AND its queue.
-- The host must cancel the night first.
create or replace function delete_draft_itinerary(p_itinerary_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_owner uuid; v_posted int;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select user_id into v_owner from itineraries where id = p_itinerary_id;
  if v_owner is null then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if v_owner <> v_actor then
    raise exception 'not your draft' using errcode = '42501';
  end if;

  select count(*) into v_posted from date_instances where itinerary_id = p_itinerary_id;
  if v_posted > 0 then
    raise exception 'this plan is already posted as a night — take the night down first'
      using errcode = 'P0001';
  end if;

  delete from itineraries where id = p_itinerary_id and user_id = v_actor;
end $fn$;

revoke execute on function delete_draft_itinerary(uuid) from public;
revoke execute on function delete_draft_itinerary(uuid) from anon;
grant execute on function delete_draft_itinerary(uuid) to authenticated;

-- ── clone_itinerary_as_draft ──────────────────────────────────────────
-- Copy an itinerary the caller OWNS (their own generated plan — including the
-- one behind an expired/archived night) into a brand-new, private, un-posted
-- draft, and return its id. The new row is a fresh draft: no slug, not public,
-- not featured, not posted — the editor + post_night take over from there. The
-- source is left untouched (non-destructive "use again"). Only content columns
-- confirmed present on prod are copied; identity/lifecycle columns reset to
-- their column defaults.
create or replace function clone_itinerary_as_draft(p_source_id uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_actor uuid := auth.uid(); v_new_id uuid;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  insert into itineraries (
    user_id, inputs, stops, title, hook, why_it_works, why_note,
    total_cost_pp, total_duration_min, city_id, cover_image_url,
    cover_image_prompt, ambient_sound_url, vibe_tags, pay_setting,
    intent, season, built_by_name, built_by_neighborhood, is_public
  )
  select
    v_actor, inputs, stops, title, hook, why_it_works, why_note,
    total_cost_pp, total_duration_min, city_id, cover_image_url,
    cover_image_prompt, ambient_sound_url, vibe_tags, pay_setting,
    intent, season, built_by_name, built_by_neighborhood, false
  from itineraries
  where id = p_source_id and user_id = v_actor
  returning id into v_new_id;

  -- No row → the source isn't the caller's (or doesn't exist). Same "gone" code
  -- the UI maps to a dry line; never reveal someone else's itinerary exists.
  if v_new_id is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  return v_new_id;
end $fn$;

revoke execute on function clone_itinerary_as_draft(uuid) from public;
revoke execute on function clone_itinerary_as_draft(uuid) from anon;
grant execute on function clone_itinerary_as_draft(uuid) to authenticated;
