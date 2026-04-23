// Server-side fetch of itineraries "like this one" — same template, public,
// excluding the current plan. Used by the SimilarPlans carousel on plan detail.
//
// Ranking: loved_count DESC then recency. We keep it cheap and dumb until
// engagement signal proves a smarter ranker is needed.

import { createAdminClient } from '@/lib/supabase/admin';
import type { Stop } from './itinerary-types';

export interface SimilarPlanCard {
  id: string;
  slug: string;
  title: string;
  hook: string | null;
  total_cost_pp: number;
  total_duration_min: number;
  loved_count: number;
  template_id: string;
  cover_photo: string | null;
  cover_type: string | null;
  stop_count: number;
}

export async function loadSimilarPlans(
  itinerary: { id: string; template_id: string },
  limit = 6,
): Promise<SimilarPlanCard[]> {
  // Admin client: itineraries RLS limits public reads in some envs and we
  // already gate on is_public + slug presence below. Service role lets us
  // pick the cheapest query path.
  const admin = createAdminClient();
  const { data } = await admin
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, loved_count, template_id, stops, cover_image_url')
    .eq('template_id', itinerary.template_id)
    .eq('is_public', true)
    .neq('id', itinerary.id)
    .not('slug', 'is', null)
    .order('loved_count', { ascending: false, nullsFirst: false })
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data
    .filter((r): r is typeof r & { slug: string } => typeof r.slug === 'string')
    .map((r) => {
      const stops = (Array.isArray(r.stops) ? r.stops : []) as unknown as Stop[];
      const withPhoto = stops.find((s) => s.photo_url);
      // Prefer the AI-generated branded cover when present (avoids two
      // similar plans sharing the same stop photo).
      const aiCover = (r as { cover_image_url?: string | null }).cover_image_url ?? null;
      return {
        id: r.id,
        slug: r.slug,
        title: r.title ?? 'A Kelowna night',
        hook: r.hook ?? null,
        total_cost_pp: Number(r.total_cost_pp ?? 0),
        total_duration_min: r.total_duration_min ?? 0,
        loved_count: r.loved_count ?? 0,
        template_id: r.template_id ?? '',
        cover_photo: aiCover ?? withPhoto?.photo_url ?? null,
        cover_type: stops[0]?.place_type ?? null,
        stop_count: stops.length,
      };
    });
}
