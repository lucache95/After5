// Template selection — score templates against user inputs, return top N.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { PlanInputs, Template } from './types.ts';

// Mirror of MUST_INCLUDE_TYPE_MAP in places-filter.ts. Used here to filter
// out templates whose slots can't satisfy a must_include — fixes the bug
// where picking "drinks" + a 2-slot activity template returned a plan with
// zero drink stops because the candidate POOL had drinks but the slots
// didn't accept them.
const MUST_INCLUDE_TYPES: Record<string, string[]> = {
  food:        ['restaurant', 'cafe'],
  drinks:      ['cocktail_bar', 'brewery', 'winery'],
  walk:        ['walk', 'park', 'garden'],
  view:        ['viewpoint', 'sunset_spot', 'beach'],
  activity:    ['activity', 'hike'],
  dessert:     ['dessert', 'ice_cream', 'bakery'],
  hidden_gem:  [],
  lake:        ['beach', 'walk'],
  outdoors:    ['hike', 'walk', 'park', 'garden', 'beach', 'viewpoint', 'sunset_spot', 'activity'],
  indoors:     ['restaurant', 'cafe', 'cocktail_bar', 'brewery', 'dessert', 'gallery', 'bakery'],
};

// Returns true if every must_include can be satisfied by at least one slot
// in the template (the slot's `types` overlaps with the must_include's
// allowed types).
export function templateSatisfiesMustIncludes(t: Template, must_includes: string[]): boolean {
  for (const must of must_includes) {
    if (must === 'hidden_gem') continue; // pairing-tag, not slot-type
    const allowed = MUST_INCLUDE_TYPES[must] ?? [];
    if (allowed.length === 0) continue;
    const ok = t.slots.some((slot) => slot.types.some((type) => allowed.includes(type)));
    if (!ok) return false;
  }
  return true;
}

export async function loadTemplates(
  supabase: SupabaseClient,
  occasion: string
): Promise<Template[]> {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .contains('suitable_for', [occasion])
    .eq('is_active', true);
  if (error) throw new Error(`templates query failed: ${error.message}`);
  return (data ?? []) as Template[];
}

export function scoreTemplate(t: Template, inputs: PlanInputs): number {
  let score = 0;

  // Vibe overlap (each match worth 2)
  const vibeMatches = t.vibe.filter((v) => inputs.vibe.includes(v)).length;
  score += vibeMatches * 2;

  // Duration fit (within ±30% of target = full credit, falling off linearly)
  const targetDur = inputs.duration_min;
  const dur = t.duration_min;
  const tolerance = Math.max(60, targetDur * 0.3);
  const durDelta = Math.abs(dur - targetDur);
  const durScore = Math.max(0, 1 - durDelta / tolerance) * 3;
  score += durScore;

  // Apply selection_weight (default 1)
  // Templates that historically generate better feedback get boosted (Phase 4+)

  return score;
}

export function selectTopTemplates(
  templates: Template[],
  inputs: PlanInputs,
  n = 3
): Template[] {
  const eligible = templates.filter((t) =>
    templateSatisfiesMustIncludes(t, inputs.must_includes ?? []),
  );
  const scored = eligible
    .map((t) => ({ t, score: scoreTemplate(t, inputs) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, n).map((x) => x.t);
}
