// Editorial packs — themed constraint sets that override/augment default
// scoring to make dates feel curated rather than algorithmic.
//
// Each pack specifies venue constraints, sequence rules, budget range,
// time-of-day affinity, and a "voice note" injected into the LLM prompt
// to set tone. Packs are selected deterministically based on user inputs
// or applied randomly when no strong signal exists ("surprise me").

import type { EditorialPack, PlanInputs, Place } from './types.ts';

// ─── Predicate registry ────────────────────────────────────────────────
// Predicates are string keys resolved here to actual filter functions.
// This keeps the pack definitions pure JSON-like data.

type PredicateFn = (place: Place) => boolean;

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;

const PREDICATES: Record<string, PredicateFn> = {
  // The Underrated Tuesday
  low_appearances: (p) => (p.total_appearances ?? 0) < 10,
  recently_added: (p) => {
    if (!p.created_at) return false;
    return Date.now() - new Date(p.created_at).getTime() < EIGHTEEN_MONTHS_MS;
  },

  // Off the Beaten Path
  has_hidden_insight: (p) => {
    const insight = (p.local_insight ?? '').toLowerCase();
    return insight.includes('hidden') || insight.includes('secret') || insight.includes('tucked');
  },

  // Sunset Date
  is_outdoor: (p) => ['hike', 'viewpoint', 'beach', 'park', 'garden', 'sunset_spot', 'walk'].includes(p.type),
  is_view_spot: (p) => ['viewpoint', 'sunset_spot', 'beach'].includes(p.type),

  // The Classic Done Right
  high_quality: (p) => p.quality_score >= 8 && p.feedback_score >= 3,
  has_vibe_tag_upscale: (p) => p.vibe_tags.some((v) => ['upscale', 'romantic', 'intimate', 'classy'].includes(v)),

  // Morning After
  is_coffee: (p) => p.type === 'cafe',
  is_activity: (p) => ['activity', 'hike', 'walk', 'gallery', 'market'].includes(p.type),
  is_brunch_friendly: (p) => p.type === 'restaurant' || p.type === 'cafe',

  // Adventure Date
  is_high_effort: (p) => p.effort === 'high' || p.effort === 'moderate',
  is_outdoor_activity: (p) => ['hike', 'activity', 'beach'].includes(p.type) && p.effort !== 'low',

  // Date Night In... Out
  is_at_home: (p) => p.at_home === true,

  // General — recency boost
  added_last_6_months: (p) => {
    if (!p.created_at) return false;
    return Date.now() - new Date(p.created_at).getTime() < SIX_MONTHS_MS;
  },

  // Delighter detection
  is_delighter: (p) => p.is_delighter === true,
};

export function resolvePredicate(key: string): PredicateFn {
  return PREDICATES[key] ?? (() => false);
}

// ─── Pack definitions ──────────────────────────────────────────────────

const PACKS: EditorialPack[] = [
  {
    id: 'underrated-tuesday',
    name: 'The Underrated Tuesday',
    voice_note:
      'This date is built from places most people walk past. Write like you\'re letting someone in on a local secret — no hype, just genuine discovery. The vibe is "I can\'t believe we didn\'t know about this."',
    venue_constraints: [
      { min_count: 1, predicate: 'low_appearances' },
      { min_count: 1, predicate: 'recently_added' },
    ],
    sequence_rules: [],
    budget_range: null,
    time_of_day: ['evening'],
    occasions: ['date'],
    vibe_affinity: ['chill', 'adventurous', 'local', 'cozy'],
    scoring_overrides: [
      { predicate: 'low_appearances', delta: 5 },
      { predicate: 'recently_added', delta: 3 },
    ],
  },

  {
    id: 'off-beaten-path',
    name: 'Off the Beaten Path',
    voice_note:
      'These are the spots locals gate-keep. Write with insider energy — short, knowing, like recommending a place to your closest friend. Avoid anything that sounds like a travel blog.',
    venue_constraints: [
      { min_count: 1, predicate: 'has_hidden_insight' },
    ],
    sequence_rules: [],
    budget_range: null,
    time_of_day: null,
    occasions: null,
    vibe_affinity: ['adventurous', 'local', 'offbeat', 'chill'],
    scoring_overrides: [
      { predicate: 'has_hidden_insight', delta: 6 },
      { predicate: 'low_appearances', delta: 4 },
    ],
  },

  {
    id: 'sunset-date',
    name: 'Sunset Date',
    voice_note:
      'The whole date builds toward golden hour. Write with warm, sensory language — lake light, the way the West side glows, the temperature dropping just enough. The last stop should feel like the payoff.',
    venue_constraints: [
      { min_count: 1, predicate: 'is_outdoor' },
    ],
    sequence_rules: [
      { position: 'last', predicate: 'is_view_spot' },
    ],
    budget_range: null,
    time_of_day: ['evening'],
    occasions: ['date'],
    vibe_affinity: ['romantic', 'scenic', 'relaxed', 'outdoorsy'],
    scoring_overrides: [
      { predicate: 'is_outdoor', delta: 3 },
      { predicate: 'is_view_spot', delta: 5 },
    ],
  },

  {
    id: 'classic-done-right',
    name: 'The Classic Done Right',
    voice_note:
      'Dinner and drinks — but not boring dinner and drinks. Every stop earns its slot. Write with quiet confidence; this plan doesn\'t need to try hard because the places speak for themselves.',
    venue_constraints: [
      { min_count: 1, predicate: 'high_quality' },
    ],
    sequence_rules: [],
    budget_range: { min: 40, max: 150 },
    time_of_day: ['evening'],
    occasions: ['date'],
    vibe_affinity: ['romantic', 'upscale', 'classy', 'intimate', 'date-night'],
    scoring_overrides: [
      { predicate: 'high_quality', delta: 4 },
      { predicate: 'has_vibe_tag_upscale', delta: 3 },
    ],
  },

  {
    id: 'morning-after',
    name: 'Morning After',
    voice_note:
      'Brunch energy. Start slow with good coffee, end with something that gets you both moving. Write casually — this isn\'t a big production, it\'s a really good morning that happens to be planned. Budget-conscious without feeling cheap.',
    venue_constraints: [
      { min_count: 1, predicate: 'is_coffee' },
      { min_count: 1, predicate: 'is_activity' },
    ],
    sequence_rules: [
      { position: 0, predicate: 'is_coffee' },
    ],
    budget_range: { min: 0, max: 60 },
    time_of_day: ['morning', 'all_day'],
    occasions: ['date', 'friends'],
    vibe_affinity: ['chill', 'casual', 'local', 'cozy'],
    scoring_overrides: [
      { predicate: 'is_coffee', delta: 3 },
      { predicate: 'is_brunch_friendly', delta: 2 },
    ],
  },

  {
    id: 'adventure-date',
    name: 'Adventure Date',
    voice_note:
      'This one has a pulse. Write with energy — not breathless, but the kind of plan where you\'re both a little tired and very happy afterward. Lean into the physical: the climb, the cold water, the view you earned.',
    venue_constraints: [
      { min_count: 1, predicate: 'is_outdoor_activity' },
    ],
    sequence_rules: [],
    budget_range: null,
    time_of_day: ['morning', 'all_day'],
    occasions: ['date', 'friends'],
    vibe_affinity: ['adventurous', 'active', 'outdoorsy', 'energetic'],
    scoring_overrides: [
      { predicate: 'is_high_effort', delta: 4 },
      { predicate: 'is_outdoor', delta: 3 },
    ],
  },

  {
    id: 'date-night-in-out',
    name: 'Date Night In... Out',
    voice_note:
      'Starts at home — a recipe, a cocktail, something you make together. Then one curated outing that feels like a reward. Write the at-home part with specificity (what to make, what to play), and the outing as the contrast that makes the night feel complete.',
    venue_constraints: [],
    sequence_rules: [],
    budget_range: { min: 0, max: 80 },
    time_of_day: ['evening'],
    occasions: ['date'],
    vibe_affinity: ['cozy', 'intimate', 'romantic', 'chill'],
    scoring_overrides: [
      { predicate: 'is_at_home', delta: 5 },
    ],
  },
];

// ─── Pack selection ────────────────────────────────────────────────────

/** Score how well a pack matches user inputs. Higher = better fit. */
function scorePackFit(pack: EditorialPack, inputs: PlanInputs): number {
  let score = 0;

  // Occasion match
  if (pack.occasions && pack.occasions.includes(inputs.occasion)) score += 3;
  if (pack.occasions && !pack.occasions.includes(inputs.occasion)) score -= 10;

  // Time-of-day match
  const inputTod = inputs.time_of_day ?? 'evening';
  if (pack.time_of_day && pack.time_of_day.includes(inputTod)) score += 3;
  if (pack.time_of_day && !pack.time_of_day.includes(inputTod)) score -= 5;

  // Budget range match
  if (pack.budget_range) {
    const b = inputs.budget_per_person;
    if (b >= pack.budget_range.min && b <= pack.budget_range.max) score += 2;
    else if (b < pack.budget_range.min || b > pack.budget_range.max) score -= 3;
  }

  // Vibe overlap — strongest signal
  const vibeOverlap = inputs.vibe.filter((v) => pack.vibe_affinity.includes(v)).length;
  score += vibeOverlap * 2;

  // Intent affinity
  if (inputs.intent === 'try_something_new') {
    if (['underrated-tuesday', 'off-beaten-path', 'adventure-date'].includes(pack.id)) score += 3;
  }
  if (inputs.intent === 'impress') {
    if (['classic-done-right', 'sunset-date'].includes(pack.id)) score += 3;
  }
  if (inputs.intent === 'chill') {
    if (['morning-after', 'date-night-in-out'].includes(pack.id)) score += 2;
  }

  return score;
}

/**
 * Select the best editorial pack for the given inputs.
 * Returns null if no pack scores above the minimum threshold (the plan
 * runs with default scoring — no editorial override).
 *
 * When `surpriseMe` is true (no strong user signal), picks randomly from
 * packs that don't conflict with the inputs.
 */
export function selectPack(
  inputs: PlanInputs,
  surpriseMe = false,
): EditorialPack | null {
  const scored = PACKS
    .map((pack) => ({ pack, score: scorePackFit(pack, inputs) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  if (surpriseMe) {
    // Weighted random from top half of eligible packs
    const pool = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
    const minScore = pool[pool.length - 1].score;
    const weights = pool.map((x) => x.score - minScore + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i].pack;
    }
    return pool[0].pack;
  }

  // Deterministic: best match, but only if it's a strong enough signal
  const best = scored[0];
  if (best.score >= 3) return best.pack;

  return null;
}

/**
 * Returns true if the candidate pool can satisfy all venue constraints
 * of a pack. Used as a pre-check so we don't apply a pack that will
 * produce impossible plans.
 */
export function packIsSatisfiable(pack: EditorialPack, candidates: Place[]): boolean {
  for (const constraint of pack.venue_constraints) {
    const predFn = resolvePredicate(constraint.predicate);
    const matching = candidates.filter(predFn);
    if (matching.length < constraint.min_count) return false;
  }
  return true;
}

/**
 * After stops are selected, enforce sequence rules by swapping stops
 * to satisfy position constraints. Returns number of swaps made.
 * Mutates the stops array of the itinerary in place.
 */
export function enforceSequenceRules(
  pack: EditorialPack,
  stops: Array<{ place_id: string }>,
  candidates: Place[],
): number {
  if (pack.sequence_rules.length === 0) return 0;

  let swaps = 0;
  for (const rule of pack.sequence_rules) {
    const targetIdx = rule.position === 'last' ? stops.length - 1 : rule.position;
    if (targetIdx < 0 || targetIdx >= stops.length) continue;

    const predFn = resolvePredicate(rule.predicate);
    const currentPlace = candidates.find((c) => c.id === stops[targetIdx].place_id);
    if (currentPlace && predFn(currentPlace)) continue; // already satisfied

    // Find a stop that satisfies the predicate and swap it into position
    for (let i = 0; i < stops.length; i++) {
      if (i === targetIdx) continue;
      const candidatePlace = candidates.find((c) => c.id === stops[i].place_id);
      if (candidatePlace && predFn(candidatePlace)) {
        const tmp = stops[targetIdx];
        stops[targetIdx] = stops[i];
        stops[i] = tmp;
        swaps++;
        break;
      }
    }
  }
  return swaps;
}

/** Detect "surprise me" — weak or absent user signal. */
export function isSurpriseMe(inputs: PlanInputs): boolean {
  // No intent + generic vibe = weak signal. Empty-string intent is falsy, so
  // `!inputs.intent` already covers both absent and '' (the redundant
  // `=== ''` comparison was removed — it tripped strict type-narrowing).
  const weakIntent = !inputs.intent;
  const genericVibe = inputs.vibe.length <= 1;
  return weakIntent && genericVibe;
}

export { PACKS };
