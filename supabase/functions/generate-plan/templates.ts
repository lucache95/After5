// Template selection — score templates against user inputs, return top N.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { PlanInputs, Template } from './types.ts';

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
  const scored = templates
    .map((t) => ({ t, score: scoreTemplate(t, inputs) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, n).map((x) => x.t);
}
