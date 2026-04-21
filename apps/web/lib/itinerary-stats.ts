// Server-side aggregate stats from plan_feedback for a single itinerary.
// Surfaced near the title as Airbnb-style chips ("★ 4.8 · 12 reviews",
// "Top stop: Quails' Gate", etc.) — only when there's enough signal to
// be meaningful (≥3 feedback entries).

import { createClient } from '@/lib/supabase/server';

export interface ItineraryStats {
  reviewCount: number;
  /** 1.0–5.0, derived from would_do (yes=5, maybe=3, no=1). null if no signal */
  qualityScore: number | null;
  /** % who said they'd do it (yes / total) — capped at 100 */
  wouldDoPct: number | null;
  /** place_name with the most up-votes across all feedback. null if no signal */
  topStop: string | null;
  /** True when this plan has been featured / loved enough to flag */
  isGuestFavourite: boolean;
}

interface FeedbackRow {
  would_do: string | null;
  stop_votes: Record<string, 'up' | 'down'> | null;
}

export async function loadItineraryStats(
  itineraryId: string,
  stops: { place_id: string; place_name: string }[],
): Promise<ItineraryStats> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_feedback')
    .select('would_do, stop_votes')
    .eq('itinerary_id', itineraryId);

  const rows = (data ?? []) as FeedbackRow[];
  const reviewCount = rows.length;

  // Need at least 3 reviews to surface anything; below that the noise
  // is too high.
  if (reviewCount < 3) {
    return {
      reviewCount,
      qualityScore: null,
      wouldDoPct: null,
      topStop: null,
      isGuestFavourite: false,
    };
  }

  // would_do → 5/3/1 stars
  const stars: number[] = [];
  for (const r of rows) {
    if (r.would_do === 'yes') stars.push(5);
    else if (r.would_do === 'maybe') stars.push(3);
    else if (r.would_do === 'no') stars.push(1);
  }
  const qualityScore = stars.length > 0
    ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10
    : null;

  const yesCount = rows.filter((r) => r.would_do === 'yes').length;
  const wouldDoPct = stars.length > 0
    ? Math.round((yesCount / stars.length) * 100)
    : null;

  // Tally stop votes
  const tally: Record<string, number> = {};
  for (const r of rows) {
    if (!r.stop_votes) continue;
    for (const [pid, vote] of Object.entries(r.stop_votes)) {
      if (vote === 'up') tally[pid] = (tally[pid] ?? 0) + 1;
      else if (vote === 'down') tally[pid] = (tally[pid] ?? 0) - 1;
    }
  }
  let topStop: string | null = null;
  let topScore = -Infinity;
  for (const s of stops) {
    const score = tally[s.place_id] ?? 0;
    if (score > topScore && score > 0) {
      topScore = score;
      topStop = s.place_name;
    }
  }

  // Guest favourite: ≥10 reviews AND ≥4.5 stars
  const isGuestFavourite = reviewCount >= 10 && (qualityScore ?? 0) >= 4.5;

  return { reviewCount, qualityScore, wouldDoPct, topStop, isGuestFavourite };
}
