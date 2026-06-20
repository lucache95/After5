// apps/web/lib/after5/client.ts
// Single typed entry the onboarding/home client components use to call the merged
// @after5/api-client helpers. The @supabase/ssr browser client is a
// SupabaseClient<Database>, which IS After5Client, so we reuse it directly
// (one client, cookie-backed session shared with SSR). Import the helpers from
// '@after5/api-client' and pass this client.
'use client';
import { createClient } from '@/lib/supabase/client';
import type { After5Client } from '@after5/api-client';

export function browserAfter5Client(): After5Client {
  // createClient() returns createBrowserClient<Database>(...), structurally a
  // SupabaseClient<Database> === After5Client. No cast hole: the generic matches.
  return createClient();
}

// Convenience re-export so steps import client + helpers from one place.
export {
  getMyProfile, upsertProfile, savePreferences, getMyBadge,
  startVerification, confirmPhone, advanceOnboarding, registerDevice,
  saveFeedFilters, type FeedFilters,
} from '@after5/api-client';
export {
  postNight, browseFeed, recordSwipe, getNightDetail, reachPreview,
  ambientSoundUrl, listAmbientSounds, cancelNight, updateNight, withdrawInterest, updateItineraryStops,
  deleteDraftItinerary, cloneItineraryAsDraft,
  type FeedNight, type NightDetailNight, type NightDetailStop, type AmbientSound,
} from '@after5/api-client';
