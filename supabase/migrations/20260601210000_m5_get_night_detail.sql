-- supabase/migrations/20260601210000_m5_get_night_detail.sql
-- M5: blind-safe FULL date detail for the swiper. The swiper taps a feed card and
-- reads the real itinerary (stops, venues, cost, story, map) BEFORE deciding —
-- "swipe on the night, not the person."
--
-- BLIND CONTRACT (mirrors browse_feed_for_viewer + its _drop_itinerary_id fix):
--   * NO host identity: creator_id, itinerary_id, venue_id, host name/photo/socials
--     never appear in the return signature. itinerary_id is omitted for the SAME
--     reason 20260527120400 dropped it from the feed: it joins itineraries.user_id
--     (world-readable) to de-anonymize the creator.
--   * time is hour-truncated (never minute-precise), exactly like the feed.
--   * per-stop reservation_url is scrubbed (a host could embed an identifying link);
--     booking links are surfaced post-lock by other surfaces, not here.
--
-- ELIGIBILITY: returns a row only when the instance passes the feed's hard
-- publication gates (seeking, future, approved, creator active/verified/dating,
-- not self). It does NOT re-run the mutual-compatibility/distance filter — the
-- viewer already holds the card from the feed; re-deriving per-tap is redundant
-- and would reject curated seeds the feed surfaced. Guessing a UUID still cannot
-- read a withdrawn/unapproved/own instance.
--
-- DECISION LOCKED: published nights use curated/vetted venues, so venue names,
-- coords, and cost are safe to show pre-swipe. The contract protects the host's
-- IDENTITY, not the venue list.

create or replace function get_night_detail(p_instance uuid)
returns table (
  date_instance_id uuid,
  time_window_start timestamptz,
  pay_setting text,
  vibe_tags text[],
  why_note text,
  hook text,
  why_it_works text,
  cover_image_url text,
  title text,
  venue_neighborhood text,
  is_seed boolean,
  total_cost_pp numeric,
  total_duration_min int,
  stops jsonb
) language sql security definer set search_path = public, extensions as $fn$
  select
    di.id,
    date_trunc('hour', di.starts_at) as time_window_start,
    it.pay_setting::text,
    it.vibe_tags,
    it.why_note,
    it.hook,
    it.why_it_works,
    it.cover_image_url,
    it.title,
    pl.neighborhood,
    di.is_seed,
    it.total_cost_pp,
    it.total_duration_min,
    -- Scrub reservation_url from every stop: it's the only host-AUTHORED free-form
    -- field on a stop (a host could embed an identifying/personal booking link). Every
    -- other stop field (place_name/place_slug/address/coords/photo/local_insight) is
    -- derived from the curated `places` catalog, which has no host/owner column, so it's
    -- safe pre-swipe per the locked decision. NOTE: any future host-authored stop field
    -- must be scrubbed here too.
    -- Guarded: legacy/thin rows may store a non-array jsonb; only iterate arrays.
    case when jsonb_typeof(it.stops) = 'array'
      then coalesce(
        (select jsonb_agg(s - 'reservation_url') from jsonb_array_elements(it.stops) as s),
        '[]'::jsonb)
      else '[]'::jsonb
    end as stops
  from date_instances di
  join profiles cr on cr.id = di.creator_id
  join itineraries it on it.id = di.itinerary_id
  left join places pl on pl.id = di.venue_id
  where di.id = p_instance
    and di.status = 'seeking'
    and di.starts_at > now()
    and di.moderation_status = 'approved'
    and cr.account_state = 'active'
    and cr.standing not in ('suspended','locked_ban')
    and cr.verification = 'verified'
    and cr.dating_enabled = true
    and di.creator_id <> auth.uid();
$fn$;

-- Supabase default privileges auto-grant EXECUTE to anon on new public functions,
-- so revoking from public is NOT enough — revoke anon explicitly (authenticated-only,
-- matching browse_feed_for_viewer). cf. the same gotcha on the DEFINER reveal helpers.
revoke execute on function get_night_detail(uuid) from public;
revoke execute on function get_night_detail(uuid) from anon;
grant execute on function get_night_detail(uuid) to authenticated;
