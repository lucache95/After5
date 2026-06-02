import type { After5Client } from './index';

export interface FeedNight {
  date_instance_id: string; city_id: string; time_window_start: string;
  pay_setting: string | null; vibe_tags: string[] | null;
  why_note: string | null; cover_image_url: string | null; title: string | null;
  venue_neighborhood: string | null; is_seed: boolean; distance_m: number | null;
  // M4: resolved ambient pick (host's choice or vibe-auto fallback). Path is relative
  // to the public 'ambient-sounds' bucket; prefix with ambientSoundUrl() client-side.
  ambient_sound_path: string | null; ambient_sound_name: string | null;
}

/** A curated library entry for the host's optional soundtrack pick. */
export interface AmbientSound {
  id: string; name: string; storage_path: string; vibe_tags: string[]; duration_sec: number;
}

export async function postNight(client: After5Client, input: {
  itinerary_id: string; starts_at: string; venue_id?: string | null;
  duration_min?: number; ambient_sound_id?: string | null;
}): Promise<string> {
  const { data, error } = await client.rpc('post_night', {
    p_itinerary: input.itinerary_id, p_starts_at: input.starts_at,
    p_venue: input.venue_id ?? undefined, p_duration_min: input.duration_min ?? 150,
    p_ambient_sound_id: input.ambient_sound_id ?? undefined,
  });
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
