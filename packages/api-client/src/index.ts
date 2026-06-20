// After5 — Supabase client + typed query helpers
// Used by web (apps/web) and mobile (apps/mobile, later).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@after5/types';
import type { GeneratePlanRequest, GeneratePlanResponse, FeedbackRequest } from '@after5/validators';

export type After5Client = SupabaseClient<Database>;

export function createAfter5Client(url: string, publishableKey: string): After5Client {
  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

// ─── Generation ────────────────────────────────────────────────────────

export async function generatePlan(
  client: After5Client,
  input: GeneratePlanRequest
): Promise<GeneratePlanResponse> {
  const { data, error } = await client.functions.invoke<GeneratePlanResponse>('generate-plan', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('generate-plan returned no data');
  return data;
}

// ─── Feedback ──────────────────────────────────────────────────────────

export async function submitFeedback(
  client: After5Client,
  input: FeedbackRequest
): Promise<void> {
  const { error } = await client.functions.invoke('submit-feedback', { body: input });
  if (error) throw error;
}

// ─── Reads (publishable key + RLS) ────────────────────────────────────

export async function getItinerary(client: After5Client, id: string) {
  const { data, error } = await client
    .from('itineraries')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function listPublicItineraries(client: After5Client, limit = 20) {
  const { data, error } = await client
    .from('itineraries')
    .select('*')
    .eq('is_public', true)
    .order('loved_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── Phase 1: identity / profile helpers ───────────────────────────────
export * from './profile';

// ─── Phase 5a: feed helpers ────────────────────────────────────────────
export {
  postNight, browseFeed, recordSwipe, getNightDetail, reachPreview,
  ambientSoundUrl, listAmbientSounds, updateItineraryStops, createBlankItinerary,
  cancelNight, updateNight, withdrawInterest, normalizeNightDetailStops,
  deleteDraftItinerary, cloneItineraryAsDraft,
  type FeedNight, type NightDetailNight, type NightDetailStop, type AmbientSound, type EditableStop,
} from './feed';
