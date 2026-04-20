// Query candidate places from Postgres given user inputs.
// Pure data layer — no scoring, no LLM. Just "what's plausible for this date?"

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { PlanInputs, Place } from './types.ts';

// Map a numeric per-person budget to allowed price tiers.
// Always allow $ AND $$ unless the user explicitly wants the premium pool —
// strict "$ only" at low budgets left no room to fill multi-slot templates.
function allowedTiers(budget: number): string[] {
  if (budget <= 80) return ['$', '$$'];
  return ['$', '$$', '$$$'];
}

// Map must-include tokens to candidate place types.
const MUST_INCLUDE_TYPE_MAP: Record<string, string[]> = {
  food:        ['restaurant', 'cafe'],
  drinks:      ['cocktail_bar', 'brewery', 'winery'],
  walk:        ['walk', 'park', 'garden'],
  view:        ['viewpoint', 'sunset_spot', 'beach'],
  activity:    ['activity', 'hike'],
  dessert:     ['dessert', 'ice_cream', 'bakery'],
  hidden_gem:  [],          // handled via pairing_tags below
  lake:        ['beach', 'walk'],
  outdoors:    ['hike', 'walk', 'park', 'garden', 'beach', 'viewpoint', 'sunset_spot', 'activity'],
  indoors:     ['restaurant', 'cafe', 'cocktail_bar', 'brewery', 'dessert', 'gallery', 'bakery'],
};

function currentSeason(): string {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'fall';
  return 'winter';
}

export async function filterPlaces(
  supabase: SupabaseClient,
  inputs: PlanInputs
): Promise<Place[]> {
  const tiers = allowedTiers(inputs.budget_per_person);
  const season = currentSeason();

  const query = supabase
    .from('places')
    .select(
      'id,name,slug,address,neighborhood,drive_cluster,type,vibe_tags,pairing_tags,effort,time_of_day,weather_dependent,seasonality,typical_duration_min,price_tier,typical_per_person,reservation_required,reservation_url,photo_url,lat,lng,quality_score,feedback_score,local_insight,notes,is_active'
    )
    .eq('is_active', true)
    .in('price_tier', tiers)
    .or(`seasonality.cs.{year_round},seasonality.cs.{${season}}`);

  const { data, error } = await query;
  if (error) throw new Error(`places query failed: ${error.message}`);
  if (!data) return [];

  // Post-filter: must-include type satisfaction is checked at template-fill time,
  // not at this stage — we just need a broad candidate pool.
  return data as Place[];
}

// Returns true if the candidate pool covers every must_include the user asked for.
// Used as a sanity check before assembling itineraries.
export function coversAllMustIncludes(places: Place[], must_includes: string[]): boolean {
  for (const must of must_includes) {
    const types = MUST_INCLUDE_TYPE_MAP[must] ?? [];
    if (must === 'hidden_gem') {
      if (!places.some((p) => p.pairing_tags.includes('hidden_gem'))) return false;
      continue;
    }
    if (types.length === 0) continue;
    if (!places.some((p) => types.includes(p.type))) return false;
  }
  return true;
}
