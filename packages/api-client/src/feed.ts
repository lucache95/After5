import type { Json } from '@after5/types';
import type { After5Client } from './index';

export interface FeedNight {
  date_instance_id: string; city_id: string; time_window_start: string;
  pay_setting: string | null; vibe_tags: string[] | null;
  why_note: string | null; cover_image_url: string | null; title: string | null;
  venue_neighborhood: string | null; is_seed: boolean; distance_m: number | null;
  // M4: resolved ambient pick (host's choice or vibe-auto fallback). Path is relative
  // to the public 'ambient-sounds' bucket; prefix with ambientSoundUrl() client-side.
  ambient_sound_path: string | null; ambient_sound_name: string | null;
  // E10 (REQ-E10 / D-03): pure targeting signal (date_fits_viewer only), never gated by
  // the soft feed-filter score. True even when the viewer has empty feed_filters, so a
  // perfectly targeted night still shows the fit pill. Source: browse_feed_for_viewer.
  fit: boolean;
  // E15 (REQ-E15 / D-01): limited host hint — the blind contract preserved minus these 3.
  // The RPC returns the relative blurred PATH; feed/page.tsx signs it into a URL (RPCs
  // cannot mint signed urls). NEVER the clear photo, full name, or DOB.
  host_blurred_photo_url: string | null; // signed blurred-photo url (NOT clear)
  host_first_name: string | null;        // first name only — never full name
  host_age: number | null;               // age only — never DOB
  // E23 (REQ-E23): human city label (cities.name) returned by browse_feed_for_viewer.
  // NightCard.tsx:54-56 already reads + lowercases this slot — no component change.
  city_name: string | null;
}

/** A curated library entry for the host's optional soundtrack pick. */
export interface AmbientSound {
  id: string; name: string; storage_path: string; vibe_tags: string[]; duration_sec: number;
}

export async function postNight(client: After5Client, input: {
  itinerary_id: string; starts_at: string; venue_id?: string | null;
  duration_min?: number; ambient_sound_id?: string | null;
  // E11 (REQ-E11): per-date targeting, persisted onto the date_instances row.
  // target_age_range is a Postgres int4range literal, e.g. '[25,40)'. search_radius_km
  // is numeric (km). All optional: omitting them keeps the open/unbounded defaults.
  target_genders?: string[] | null;
  target_age_range?: string | null;
  search_radius_km?: number | null;
}): Promise<string> {
  const { data, error } = await client.rpc('post_night', {
    p_itinerary: input.itinerary_id, p_starts_at: input.starts_at,
    p_venue: input.venue_id ?? undefined, p_duration_min: input.duration_min ?? 150,
    p_ambient_sound_id: input.ambient_sound_id ?? undefined,
    p_target_genders: input.target_genders ?? undefined,
    p_target_age_range: input.target_age_range ?? undefined,
    p_search_radius_km: input.search_radius_km ?? undefined,
  } as never);
  if (error) throw error;
  return data as string;
}

// ─── Phase 02 E6/E7: host cancel + edit wrappers ──────────────────────────────
// Both call CREATOR-ONLY DEFINER RPCs (cancel_night / update_night, migrations
// 20260604122000/123000). The RPC re-checks p_actor = auth.uid(), so the wrapper
// reads the signed-in uid from the client and passes it as p_actor. A client-side
// UUID p_idem_key makes a retry a clean no-op (idempotency ledger). Same shape as
// postNight: client.rpc(fn, { p_... }); if (error) throw error.

// Web Crypto is a global in both the browser and Node ≥ 22 (this package's
// engines floor). The package's tsconfig ships no DOM/node lib, so reach it
// through globalThis with a narrow local type instead of pulling in @types/node.
function newIdemKey(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (!uuid) throw new Error('crypto.randomUUID unavailable');
  return uuid;
}

async function actorId(client: After5Client): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const uid = data.user?.id;
  if (!uid) throw new Error('not signed in');
  return uid;
}

/** Soft-cancel (unpublish) the host's own seeking night. Reversible — the row +
 *  interest data are kept; the night just leaves feed eligibility. Throws on error. */
export async function cancelNight(
  client: After5Client,
  input: { instance_id: string; idem_key?: string },
): Promise<void> {
  const { error } = await client.rpc('cancel_night', {
    p_actor: await actorId(client),
    p_instance: input.instance_id,
    p_idem_key: input.idem_key ?? newIdemKey(),
  });
  if (error) throw error;
}

/** Edit the host's own seeking night. Only the supplied fields change; an omitted
 *  field is sent as null, which the RPC treats as "leave unchanged". Throws on error. */
export async function updateNight(
  client: After5Client,
  input: {
    instance_id: string;
    starts_at?: string | null;
    duration_min?: number | null;
    venue?: string | null;
    ambient_sound_id?: string | null;
    idem_key?: string;
  },
): Promise<void> {
  const { error } = await client.rpc('update_night', {
    p_actor: await actorId(client),
    p_instance: input.instance_id,
    p_starts_at: input.starts_at ?? null,
    p_duration_min: input.duration_min ?? null,
    p_venue: input.venue ?? null,
    p_ambient_sound_id: input.ambient_sound_id ?? null,
    p_idem_key: input.idem_key ?? newIdemKey(),
  } as never);
  if (error) throw error;
}

/** E24 (REQ-E24): pull a plain interested queue interest before the offer stage,
 *  distinct from the offer-stage withdraw. Calls the DEFINER RPC withdraw_interest
 *  (migration 20260606140200), which re-checks p_actor = auth.uid() and deletes ONLY
 *  the actor's own interested row (never shortlisted/offer_active/standby/locked).
 *  Throws on error; mirrors the cancelNight/updateNight wrapper shape. */
export async function withdrawInterest(
  client: After5Client,
  input: { instance_id: string },
): Promise<void> {
  const actor = await actorId(client);
  // withdraw_interest is added by migration 20260606140200 (Phase 7); the generated
  // Database types regenerate at the gated prod-apply, so the RPC name + args are cast
  // until then (same forward-reference pattern other not-yet-applied wrappers use).
  const { error } = await (client.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: unknown }>)('withdraw_interest', {
    p_instance: input.instance_id,
    p_actor: actor,
  });
  if (error) throw error;
}

// M3: the host edit wire shape (structurally compatible with the web `Stop` type).
export interface EditableStop {
  place_id?: string; place_name: string; place_slug?: string; place_type?: string;
  start_time: string; duration_min: number; estimated_cost_pp: number;
  what_to_do?: string; drive_to_next_min?: number; photo_url?: string | null;
  address?: string | null; neighborhood?: string; lat?: number | null; lng?: number | null;
  local_insight?: string | null; reservation_url?: string | null; reservation_required?: boolean;
}

export async function updateItineraryStops(
  client: After5Client,
  input: {
    itinerary_id: string; stops: EditableStop[]; title?: string; why_note?: string;
    cover_image_url?: string;
    // E11 (REQ-E11 / D-10): pay_setting + vibe_tags now persist on the itinerary too.
    // pay_setting maps to the payment_preference enum (cast server-side). Both optional;
    // an omitted field is "leave unchanged" (coalesce in the RPC).
    pay_setting?: string; vibe_tags?: string[];
  },
): Promise<string> {
  const { data, error } = await client.rpc('update_itinerary_stops', {
    p_itinerary: input.itinerary_id,
    p_stops: input.stops as unknown as Json,
    p_title: input.title ?? undefined,
    p_why_note: input.why_note ?? undefined,
    p_cover_image_url: input.cover_image_url ?? undefined,
    p_pay_setting: input.pay_setting ?? undefined,
    p_vibe_tags: input.vibe_tags ?? undefined,
  } as never);
  if (error) throw error;
  return data as string;
}

// #85 door 2 ("start from scratch"): create an empty, private, owner-scoped itinerary
// (one blank stop) and return its id so the §2A canvas can open on it. No AI call.
// Native reuses this verbatim. Gated RPC create_blank_itinerary — see migration
// 20260603120100_m85_create_blank_itinerary.sql (NOT yet applied to prod).
export async function createBlankItinerary(client: After5Client): Promise<string> {
  const { data, error } = await client.rpc('create_blank_itinerary');
  if (error) throw error;
  return data as string;
}

// Build a public-bucket URL from a relative storage path. Returns null for null paths.
export function ambientSoundUrl(path: string | null, supabaseUrl: string): string | null {
  if (!path) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/ambient-sounds/${path}`;
}

/** Active curated library, for the host picker (loaded server-side). */
export async function listAmbientSounds(client: After5Client): Promise<AmbientSound[]> {
  const { data, error } = await client
    .from('ambient_sounds')
    .select('id, name, storage_path, vibe_tags, duration_sec')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AmbientSound[];
}

export async function browseFeed(client: After5Client, opts?: {
  afterStarts?: string | null; afterId?: string | null; limit?: number;
}): Promise<FeedNight[]> {
  const { data, error } = await client.rpc('browse_feed_for_viewer', {
    p_after_starts: opts?.afterStarts ?? undefined, p_after_id: opts?.afterId ?? undefined,
    p_limit: opts?.limit ?? 20,
  });
  if (error) throw error;
  return (data ?? []) as FeedNight[];
}

// E10 (REQ-E10): the host pre-post reach nudge. Calls the DEFINER aggregate-count RPC
// reach_preview(p_target_genders text[], p_target_age_range int4range, p_city uuid,
// p_radius_km numeric) -> integer. target_age_range is a Postgres int4range literal
// string (e.g. '[25,40)'); omitting any param sends undefined, which the RPC normalizes
// to the open/everyone default. Returns only an aggregate count (never row identity).
export async function reachPreview(
  client: After5Client,
  input: {
    target_genders?: string[];
    target_age_range?: string | null;
    city: string;
    radius_km?: number | null;
  },
): Promise<number> {
  const { data, error } = await client.rpc('reach_preview', {
    p_target_genders: input.target_genders ?? undefined,
    p_target_age_range: input.target_age_range ?? undefined,
    p_city: input.city,
    p_radius_km: input.radius_km ?? undefined,
  } as never);
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function recordSwipe(client: After5Client, instanceId: string, direction: 'left' | 'right'): Promise<void> {
  const { error } = await client.rpc('record_swipe', { p_instance: instanceId, p_direction: direction });
  if (error) throw error;
}

// ─── M5: blind-safe FULL date detail ─────────────────────────────────────────

/** One stop in a blind-safe night detail. Normalized from heterogeneous
 *  itineraries.stops jsonb (rich generated vs thin {name,type} legacy/seed). */
export interface NightDetailStop {
  name: string;
  type: string | null;
  start_time: string | null;
  duration_min: number | null;
  cost_pp: number | null;
  what_to_do: string | null;
  neighborhood: string | null;
  local_insight: string | null;
  photo_url: string | null;
  lat: number | null;
  lng: number | null;
  // E20/E21 (REQ-E20/REQ-E21): the catalog venue slug for a stop whose place_id is in
  // `places`. null for a non-catalog / legacy / seed stop (graceful degrade, D-01) — the
  // post-lock /places/[slug] link only renders when this is non-null. Sourced from the
  // rich itineraries.stops element (LockDetail loader) and merged by the E20 get_night_detail
  // RPC (feed sheet) — both flow through normalizeNightDetailStops below.
  place_slug: string | null;
  drive_to_next_min: number | null;
}

/** Full pre-swipe date detail. Carries NO host identity (no itinerary_id,
 *  creator_id, venue_id, or host name/photo) — mirrors the feed's blind contract. */
export interface NightDetailNight {
  date_instance_id: string;
  time_window_start: string;
  pay_setting: string | null;
  vibe_tags: string[] | null;
  why_note: string | null;
  hook: string | null;
  why_it_works: string | null;
  cover_image_url: string | null;
  title: string | null;
  venue_neighborhood: string | null;
  is_seed: boolean;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: NightDetailStop[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function normalizeNightDetailStops(raw: unknown): NightDetailStop[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      // rich shape uses place_name/place_type; thin seed shape uses name/type.
      name: str(o.place_name) ?? str(o.name) ?? 'a spot',
      type: str(o.place_type) ?? str(o.type),
      start_time: str(o.start_time),
      duration_min: num(o.duration_min),
      cost_pp: num(o.estimated_cost_pp),
      what_to_do: str(o.what_to_do),
      neighborhood: str(o.neighborhood),
      local_insight: str(o.local_insight),
      photo_url: str(o.photo_url),
      lat: num(o.lat),
      lng: num(o.lng),
      place_slug: str(o.place_slug),
      drive_to_next_min: num(o.drive_to_next_min),
    };
  });
}

export async function getNightDetail(
  client: After5Client,
  instanceId: string,
): Promise<NightDetailNight | null> {
  const { data, error } = await client.rpc('get_night_detail', { p_instance: instanceId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    date_instance_id: r.date_instance_id as string,
    time_window_start: r.time_window_start as string,
    pay_setting: str(r.pay_setting),
    vibe_tags: Array.isArray(r.vibe_tags) ? (r.vibe_tags as string[]) : null,
    why_note: str(r.why_note),
    hook: str(r.hook),
    why_it_works: str(r.why_it_works),
    cover_image_url: str(r.cover_image_url),
    title: str(r.title),
    venue_neighborhood: str(r.venue_neighborhood),
    is_seed: r.is_seed === true,
    total_cost_pp: num(r.total_cost_pp),
    total_duration_min: num(r.total_duration_min),
    stops: normalizeNightDetailStops(r.stops),
  };
}
