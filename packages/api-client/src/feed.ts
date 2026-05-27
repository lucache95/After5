import type { After5Client } from './index';

export interface FeedNight {
  date_instance_id: string; city_id: string; time_window_start: string;
  itinerary_id: string; pay_setting: string | null; vibe_tags: string[] | null;
  why_note: string | null; cover_image_url: string | null; title: string | null;
  venue_neighborhood: string | null; is_seed: boolean; distance_m: number | null;
}

export async function postNight(client: After5Client, input: {
  itinerary_id: string; starts_at: string; venue_id?: string | null; duration_min?: number;
}): Promise<string> {
  const { data, error } = await client.rpc('post_night', {
    p_itinerary: input.itinerary_id, p_starts_at: input.starts_at,
    p_venue: input.venue_id ?? undefined, p_duration_min: input.duration_min ?? 150,
  });
  if (error) throw error;
  return data as string;
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
