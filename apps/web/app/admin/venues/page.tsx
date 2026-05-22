// /admin/venues — QA dashboard for venue data quality.
// Server component fetches all data; VenuesDashboard handles interactivity.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/require-admin';
import { VenuesDashboard } from './venues-dashboard';

export const dynamic = 'force-dynamic';

export interface VenueRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  neighborhood: string;
  photo_url: string | null;
  daytime_photo_url: string | null;
  evening_photo_url: string | null;
  local_insight: string | null;
  feedback_score: number;
  vibe_tags: string[];
  pairing_tags: string[];
  effort: string;
  energy: string;
  perceived_value: string | null;
  time_of_day: string[];
  is_active: boolean;
  google_place_id: string | null;
  updated_at: string;
  total_appearances: number;
  total_loved: number;
  total_skipped: number;
}

export interface FeedbackRow {
  id: string;
  itinerary_id: string;
  loved_place_id: string | null;
  skipped_place_id: string | null;
  free_text: string | null;
  pacing_rating: string | null;
  created_at: string;
}

export interface PairingRow {
  place_a: string;
  place_b: string;
  appearances: number;
  loved: number;
}

export default async function AdminVenuesPage() {
  await requireAdmin('/admin/venues');
  const admin = createAdminClient();

  // Fetch all venues
  const { data: venues } = await admin
    .from('places')
    .select(
      'id, name, slug, type, neighborhood, photo_url, daytime_photo_url, evening_photo_url, local_insight, feedback_score, vibe_tags, pairing_tags, effort, energy, perceived_value, time_of_day, is_active, google_place_id, updated_at, total_appearances, total_loved, total_skipped',
    )
    .order('name', { ascending: true });

  // Fetch recent feedback (loved/skipped place mentions)
  const { data: feedback } = await admin
    .from('feedback')
    .select('id, itinerary_id, loved_place_id, skipped_place_id, free_text, pacing_rating, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  // Fetch pairings
  const { data: pairings } = await admin
    .from('pairings')
    .select('place_a, place_b, appearances, loved')
    .order('appearances', { ascending: false })
    .limit(1000);

  return (
    <VenuesDashboard
      venues={(venues ?? []) as VenueRow[]}
      feedback={(feedback ?? []) as FeedbackRow[]}
      pairings={(pairings ?? []) as PairingRow[]}
    />
  );
}
