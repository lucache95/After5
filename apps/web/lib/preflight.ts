// Client-side preflight that runs the same template-eligibility logic the
// Edge Function does. Lets us tell the user "this combo won't generate
// anything — change X" BEFORE they hit submit and wait 10s for nothing.
//
// Mirror of supabase/functions/generate-plan/templates.ts logic. Keep in sync.

import type { InputsLike, Hint } from './plan-hints';

export interface TemplateLite {
  id: string;
  name: string;
  duration_min: number;
  suitable_for: string[];
  vibe: string[];
  slots: Array<{ types: string[] }>;
}

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

function templateSatisfiesMustIncludes(t: TemplateLite, must: string[]): boolean {
  for (const m of must) {
    if (m === 'hidden_gem') continue;
    const allowed = MUST_INCLUDE_TYPES[m] ?? [];
    if (allowed.length === 0) continue;
    const ok = t.slots.some((s) => s.types.some((type) => allowed.includes(type)));
    if (!ok) return false;
  }
  return true;
}

function scoreTemplate(t: TemplateLite, vibe: string[], duration: number): number {
  let score = 0;
  const vibeMatches = t.vibe.filter((v) => vibe.includes(v)).length;
  score += vibeMatches * 2;
  const tolerance = Math.max(60, duration * 0.3);
  const durDelta = Math.abs(t.duration_min - duration);
  score += Math.max(0, 1 - durDelta / tolerance) * 3;
  return score;
}

export interface Verdict {
  /** Number of templates that would be picked at scoring time. 0 = block. */
  matching_templates: number;
  /** A hard blocker means we should refuse to submit. */
  blocker: { step: number; message: string } | null;
  /** Soft hints surfaced inline alongside the relevant step. */
  hints: Hint[];
}

export function preflight(inputs: InputsLike, templates: TemplateLite[], staticHints: Hint[]): Verdict {
  const occasionMatches = templates.filter((t) => t.suitable_for.includes(inputs.occasion));
  if (occasionMatches.length === 0) {
    return {
      matching_templates: 0,
      blocker: { step: 1, message: `No templates exist for ${inputs.occasion} yet. Try a date or solo plan.` },
      hints: staticHints,
    };
  }

  // Filter to ones whose slots can satisfy must_includes.
  const eligible = occasionMatches.filter((t) =>
    templateSatisfiesMustIncludes(t, inputs.must_includes ?? []),
  );

  if (eligible.length === 0) {
    // Identify which must_include is the problem. Check each in isolation.
    const broken = (inputs.must_includes ?? []).filter((m) => {
      if (m === 'hidden_gem') return false;
      const allowed = MUST_INCLUDE_TYPES[m] ?? [];
      if (allowed.length === 0) return false;
      // Is there ANY template (for this occasion) that has a slot for it?
      return !occasionMatches.some((t) =>
        t.slots.some((s) => s.types.some((type) => allowed.includes(type))),
      );
    });
    if (broken.length > 0) {
      return {
        matching_templates: 0,
        blocker: {
          step: 5,
          message: `No template for ${inputs.occasion} can include "${broken.join(', ')}". Drop ${broken.length === 1 ? 'it' : 'one'} and try again.`,
        },
        hints: staticHints,
      };
    }
    // Combination problem — too many must_includes for any single template.
    return {
      matching_templates: 0,
      blocker: {
        step: 5,
        message: `${inputs.must_includes.length} must-haves at once is more than any template covers. Try keeping it to 2-3.`,
      },
      hints: staticHints,
    };
  }

  // Score and count those with score > 0 (matches the Edge Function's filter).
  const scored = eligible
    .map((t) => scoreTemplate(t, inputs.vibe, inputs.duration_min))
    .filter((s) => s > 0);

  if (scored.length === 0) {
    return {
      matching_templates: 0,
      blocker: {
        step: 3,
        message: `Your vibe + duration combo doesn't fit any template. Try adding another vibe or changing the duration.`,
      },
      hints: staticHints,
    };
  }

  return { matching_templates: scored.length, blocker: null, hints: staticHints };
}
