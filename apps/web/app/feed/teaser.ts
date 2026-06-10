// Teaser feed (launch F1): the default-audience night list a signed-in but
// PRE-VERIFICATION viewer browses read-only. The personalized RPC
// (browse_feed_for_viewer) returns an EMPTY set for an un-onboarded profile —
// gender_preferences defaults to '{}' so the mutual gate `cr.gender = any('{}')`
// is false, and null age / primary_city_id NULL out the age + distance gates
// (verified empirically against the local stack, 2026-06-09). So teaser viewers
// get this server-only default-audience query instead.
//
// PRIVACY: the projection is a strict SUBSET of what browse_feed_for_viewer
// already discloses to verified browsers — blind contract intact:
//   * starts_at is hour-truncated app-side (same date_trunc('hour') blinding),
//   * host hint = blurred photo PATH + first name + age ONLY (rung 1; the path
//     is signed by the caller via the viewer's RLS'd client, exactly like the
//     verified path — never the clear photo, full name, or DOB),
//   * no creator_id / itinerary_id / venue_id / precise address.
// The WHERE mirrors the RPC's non-preference gates verbatim: seeking + future +
// approved + active/standing/verified/dating_enabled host. Viewer-preference
// gates and the swipe exclusion are intentionally absent (no prefs, no swipes
// pre-onboarding). Admin client is required because date_instances RLS is
// owner/offer-recipient-only — browsers normally only reach nights via the
// DEFINER RPC.
import type { FeedNight } from '@after5/api-client';
import { createAdminClient } from '@/lib/supabase/admin';

export interface TeaserRow {
  id: string;
  city_id: string;
  starts_at: string;
  is_seed: boolean;
  itineraries: {
    pay_setting: string | null;
    vibe_tags: string[] | null;
    why_note: string | null;
    cover_image_url: string | null;
    title: string | null;
  } | null;
  cities: { name: string | null } | null;
  places: { neighborhood: string | null } | null;
  creator: {
    blurred_photo_url: string | null;
    first_name: string | null;
    age: number | null;
  } | null;
}

const TEASER_SELECT =
  'id, city_id, starts_at, is_seed,' +
  ' itineraries!inner(pay_setting, vibe_tags, why_note, cover_image_url, title),' +
  ' cities!inner(name),' +
  ' places(neighborhood),' +
  ' creator:profiles!date_instances_creator_id_fkey!inner(blurred_photo_url, first_name, age)';

// Map a teaser row into the exact FeedNight shape the SwipeDeck renders.
// distance/ambient/fit stay null/false — the card degrades those slots already.
export function toTeaserNight(row: TeaserRow): FeedNight {
  // Same hour time-blinding as the RPC's date_trunc('hour', starts_at).
  const d = new Date(row.starts_at);
  let timeWindowStart = row.starts_at;
  if (!Number.isNaN(d.getTime())) {
    d.setUTCMinutes(0, 0, 0);
    timeWindowStart = d.toISOString();
  }
  return {
    date_instance_id: row.id,
    city_id: row.city_id,
    time_window_start: timeWindowStart,
    pay_setting: row.itineraries?.pay_setting ?? null,
    vibe_tags: row.itineraries?.vibe_tags ?? null,
    why_note: row.itineraries?.why_note ?? null,
    cover_image_url: row.itineraries?.cover_image_url ?? null,
    title: row.itineraries?.title ?? null,
    venue_neighborhood: row.places?.neighborhood ?? null,
    is_seed: row.is_seed,
    distance_m: null,
    ambient_sound_path: null,
    ambient_sound_name: null,
    fit: false,
    host_blurred_photo_url: row.creator?.blurred_photo_url ?? null,
    host_first_name: row.creator?.first_name ?? null,
    host_age: row.creator?.age ?? null,
    city_name: row.cities?.name ?? null,
  };
}

export async function teaserFeed(viewerId: string, limit = 20): Promise<FeedNight[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('date_instances')
    .select(TEASER_SELECT)
    .eq('status', 'seeking')
    .eq('moderation_status', 'approved')
    .gt('starts_at', new Date().toISOString())
    .neq('creator_id', viewerId)
    .eq('creator.verification', 'verified')
    .eq('creator.dating_enabled', true)
    .eq('creator.account_state', 'active')
    .not('creator.standing', 'in', '("suspended","locked_ban")')
    .order('starts_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as TeaserRow[]).map(toTeaserNight);
}
