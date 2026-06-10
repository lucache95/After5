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
    // DLB: host dealbreakers + lifestyle facts, SERVER-ONLY filter inputs.
    // toTeaserNight never projects them — the FeedNight sent to the client
    // stays the same strict subset of the RPC's disclosure.
    dealbreakers: string[] | null;
    smokes: boolean | null;
    drinks: boolean | null;
    has_pets: boolean | null;
    wants_kids: boolean | null;
  } | null;
}

const TEASER_SELECT =
  'id, city_id, starts_at, is_seed,' +
  ' itineraries!inner(pay_setting, vibe_tags, why_note, cover_image_url, title),' +
  ' cities!inner(name),' +
  ' places(neighborhood),' +
  ' creator:profiles!date_instances_creator_id_fkey!inner(blurred_photo_url, first_name, age,' +
  ' dealbreakers, smokes, drinks, has_pets, wants_kids)';

// ── DLB: app-side mirror of the SQL dealbreaker_blocks helper ────────────────
// (20260609120100_dlb02_browse_feed_dealbreakers.sql). The teaser bypasses the
// RPC, so its gate is mirrored here. Same semantics: a tag only blocks on the
// exact offending fact value; null (unanswered) facts NEVER block; an empty or
// missing dealbreakers list blocks nothing.
export interface LifestyleFacts {
  smokes: boolean | null;
  drinks: boolean | null;
  has_pets: boolean | null;
  wants_kids: boolean | null;
}

const DEALBREAKER_RULES: ReadonlyArray<[tag: string, fact: keyof LifestyleFacts, offending: boolean]> = [
  ['smoking', 'smokes', true],
  ['drinks_alcohol', 'drinks', true],
  ['no_alcohol', 'drinks', false],
  ['has_pets', 'has_pets', true],
  ['no_pets', 'has_pets', false],
  ['wants_kids', 'wants_kids', true],
  ['no_kids', 'wants_kids', false],
];

export function dealbreakerBlocks(
  dealbreakers: string[] | null | undefined,
  facts: Partial<LifestyleFacts> | null | undefined,
): boolean {
  if (!dealbreakers?.length || !facts) return false;
  return DEALBREAKER_RULES.some(
    ([tag, fact, offending]) => dealbreakers.includes(tag) && facts[fact] === offending,
  );
}

// MUTUAL visibility for one teaser row: the viewer's hard nos against the host's
// facts AND the host's hard nos against the viewer's facts (same mirror the RPC
// applies). Teaser users can't act anyway (the gate is at the action), but
// hiding both directions keeps the teaser an honest preview of the real feed.
export interface TeaserViewer extends LifestyleFacts {
  dealbreakers: string[] | null;
}

export function teaserVisible(row: TeaserRow, viewer: TeaserViewer | null): boolean {
  if (!viewer) return true;
  return (
    !dealbreakerBlocks(viewer.dealbreakers, row.creator) &&
    !dealbreakerBlocks(row.creator?.dealbreakers, viewer)
  );
}

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
  // DLB: a teaser viewer may already have dealbreakers/facts saved (the
  // preferences step precedes verification), so the mutual gate applies here
  // too. A missing/unreadable row degrades to no filtering (viewer = null).
  const { data: viewer } = await admin
    .from('profiles')
    .select('dealbreakers, smokes, drinks, has_pets, wants_kids')
    .eq('id', viewerId)
    .maybeSingle();
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
  // Filter AFTER the limit (no SQL-side join expression here): the teaser may
  // under-fill by however many rows the gate hides — acceptable for the
  // read-only preview surface.
  return ((data ?? []) as unknown as TeaserRow[])
    .filter((row) => teaserVisible(row, (viewer as TeaserViewer | null) ?? null))
    .map(toTeaserNight);
}
