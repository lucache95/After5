// Combination scoring + slot fill.
//
// v2 changes for plan variety:
//  - HOURS check: drop candidates that aren't open at the slot's start time.
//    Fixes bugs like "Salted Brick scheduled at 11:45 AM" when it opens at 5pm.
//  - STOCHASTIC top-K: instead of always picking the highest-scored candidate,
//    pick weighted-randomly from the top 5. Same plan never repeats verbatim,
//    quality stays high.
//  - CROSS-PLAN diversity: when generating multiple plans in one batch, the
//    caller passes `usedPlaceIds` so the scorer knocks down places already
//    used in earlier plans of the same batch by -10. Almost guarantees the
//    3 returned itineraries don't share stops.
//  - WITHIN-PLAN type diversity: penalty for picking another place of the
//    same exact type as one already picked in this plan (templates that
//    intentionally repeat — like cocktail_bar→...→cocktail_bar — still pick
//    a different bar instead of the same one twice).
//
// v3 — taste system:
//  - NEGATIVE SPACE: top-3 most-used venues in last 7 days get a soft scoring
//    penalty. Prevents the "Earls and the park" repetition problem.
//  - RECENCY BOOST: venues added in the last 6 months get a score bump when
//    user signals "trendy" / "new" / "adventurous" / "try_something_new".
//  - EDITORIAL PACK OVERRIDES: when an editorial pack is active, its
//    scoring_overrides inject additional per-predicate score deltas.
//  - DELIGHTER RULE: post-selection step injects a surprise "one weird thing"
//    stop — replaces the weakest stop or adds a bonus stop.

import type { Place, PlanInputs, Template, TemplateSlot, Itinerary, ItineraryStop, EditorialPack } from './types.ts';
import { resolvePredicate } from './editorial-packs.ts';

interface ScoredPlace {
  place: Place;
  score: number;
}

// ─── Taste context ─────────────────────────────────────────────────────
// Passed from the orchestrator so scoring can apply negative-space,
// recency, and editorial-pack overrides without fetching data itself.

export interface TasteContext {
  /** Place IDs → penalty. Top-3 most-used venues in last 7 days. */
  negativeSpacePenalties: Map<string, number>;
  /** True when user signals suggest they want new/fresh/trendy venues. */
  recencyBoostActive: boolean;
  /** Active editorial pack, if any. */
  pack: EditorialPack | null;
}

// Returns true if the place's hours window covers the slot start time.
// `opens`/`closes` are nullable; null = unknown, treated as always-open.
// Late-night closes (e.g. 01:00) are handled by allowing wraparound.
function isOpenAt(p: Place, slotStart: string): boolean {
  if (!p.opens || !p.closes) return true;
  // Empty slotStart = relaxed mode (skip hours filtering).
  if (!slotStart) return true;
  const start = toMinutes(slotStart);
  const open = toMinutes(p.opens);
  const close = toMinutes(p.closes);
  if (close > open) {
    // Same-day window: 17:00–22:00 → open at 18:00 = yes
    return start >= open && start < close;
  }
  // Wraparound: 17:00–01:00 → open at 23:00 = yes, open at 12:00 = no
  return start >= open || start < close;
}
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function placeMatchesSlot(p: Place, slot: TemplateSlot, slotStart: string): boolean {
  if (!slot.types.includes(p.type)) return false;
  if (slot.effort && slot.effort.length > 0 && !slot.effort.includes(p.effort)) return false;
  if (slot.price_tier && slot.price_tier.length > 0 && !slot.price_tier.includes(p.price_tier)) return false;
  if (slot.time_of_day && slot.time_of_day.length > 0) {
    const overlap = p.time_of_day.some((t) => slot.time_of_day!.includes(t));
    if (!overlap) return false;
  }
  if (slot.reservation_required === false && p.reservation_required === true) return false;
  if (!isOpenAt(p, slotStart)) return false;
  return true;
}

function vibeOverlap(p: Place, userVibe: string[]): number {
  return p.vibe_tags.filter((v) => userVibe.includes(v)).length;
}

function pairingBonus(p: Place, prefers: string[] | undefined): number {
  if (!prefers || prefers.length === 0) return 0;
  const overlap = p.pairing_tags.filter((t) => prefers.includes(t)).length;
  return overlap * 1.5;
}

function clusterCompatible(picked: Place[], candidate: Place): boolean {
  if (picked.length === 0) return true;
  // Stay in the same cluster, OR allow "multiple" cluster (places that span)
  const clusters = new Set(picked.map((p) => p.drive_cluster));
  if (candidate.drive_cluster === 'multiple') return true;
  for (const c of clusters) {
    if (c === candidate.drive_cluster) return true;
    if (c === 'multiple') return true;
  }
  return false;
}

function scorePlace(
  p: Place,
  slot: TemplateSlot,
  inputs: PlanInputs,
  alreadyPicked: Place[],
  usedAcrossBatch: Set<string>,
  taste?: TasteContext,
): number {
  let score = p.quality_score + p.feedback_score;
  score += vibeOverlap(p, inputs.vibe) * 1.5;
  score += pairingBonus(p, slot.prefers_pairing_tags);

  // Hard penalty for repeating the same place within this plan.
  if (alreadyPicked.some((x) => x.id === p.id)) score -= 100;

  // Cross-plan diversity: discourage re-using a place from earlier plans
  // in the same generation batch. Soft enough that a uniquely good fit can
  // still win, hard enough that the 3 plans usually don't overlap.
  if (usedAcrossBatch.has(p.id)) score -= 10;

  // Within-plan type diversity: soft penalty for stacking the same type
  // (two restaurants in a row, two cafes, etc). Templates with intentional
  // duplicates still pick a DIFFERENT place of that type rather than repeat.
  const sameTypeCount = alreadyPicked.filter((x) => x.type === p.type).length;
  if (sameTypeCount > 0) score -= 3 * sameTypeCount;

  // Penalty for breaking cluster
  if (!clusterCompatible(alreadyPicked, p)) score -= 5;

  // Tonight bias: low-friction places are easier to pull off on short
  // notice (no reservations, easy parking, quick in/out). Strong nudge.
  if (inputs.when === 'tonight') {
    if (p.friction_score === 'low') score += 4;
    else if (p.friction_score === 'high') score -= 6;
  }

  // Tight budget bias: when budget < $50/pp, prefer places that punch above
  // their price tag. Quietly tilts toward the "free dates that feel expensive"
  // angle without breaking the ranking when budget is generous.
  if (inputs.budget_per_person < 50) {
    if (p.perceived_value === 'exceeds_price') score += 3;
    else if (p.perceived_value === 'overpriced') score -= 4;
  }

  // Intent bias: try_something_new prefers under-used places (lower
  // feedback_score = less popular = more likely "discovery").
  if (inputs.intent === 'try_something_new' && p.feedback_score < 3) {
    score += 2;
  }

  // ─── v3 taste rules ────────────────────────────────────────────────

  if (taste) {
    // NEGATIVE SPACE: soft penalty for overused venues (top-3 most-used
    // in the last 7 days). Not a hard exclude — just deprioritized so they
    // can still win if they're genuinely the best fit.
    const nsPenalty = taste.negativeSpacePenalties.get(p.id);
    if (nsPenalty) score -= nsPenalty;

    // RECENCY BOOST: when the user wants something new/trendy, boost
    // venues added to the system in the last 6 months.
    if (taste.recencyBoostActive && p.created_at) {
      const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
      const ageMs = Date.now() - new Date(p.created_at).getTime();
      if (ageMs < SIX_MONTHS_MS) {
        // Stronger boost the newer the venue is. Max +4 for brand-new,
        // tapering to +1 at 6 months.
        const freshness = 1 - ageMs / SIX_MONTHS_MS;
        score += 1 + freshness * 3;
      }
    }

    // EDITORIAL PACK OVERRIDES: per-predicate score adjustments from the
    // active pack. Each override tests the place against a predicate and
    // applies a delta (positive = boost, negative = penalty).
    if (taste.pack) {
      for (const override of taste.pack.scoring_overrides) {
        const predFn = resolvePredicate(override.predicate);
        if (predFn(p)) score += override.delta;
      }
    }
  }

  return score;
}

// Weighted-random pick from the top K candidates by score. Higher scored
// candidates are more likely, but not guaranteed — adds variety across reruns.
function pickFromTop<T extends ScoredPlace>(scored: T[], k = 5): T | null {
  if (scored.length === 0) return null;
  const top = scored.slice(0, Math.min(k, scored.length));
  // Shift weights so even the lowest in top-K has a non-zero chance.
  const minScore = top[top.length - 1].score;
  const offset = minScore < 0 ? -minScore + 1 : 1;
  const weights = top.map((s) => s.score + offset);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < top.length; i++) {
    r -= weights[i];
    if (r <= 0) return top[i];
  }
  return top[0];
}

interface ParsedTime {
  hours: number;
  minutes: number;
}

function parseTime(t: string): ParsedTime {
  const [h, m] = t.split(':').map((s) => parseInt(s, 10));
  return { hours: h, minutes: m };
}

function addMinutes(t: string, mins: number): string {
  const { hours, minutes } = parseTime(t);
  const total = hours * 60 + minutes + mins;
  const h = Math.floor((total / 60) % 24);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DEFAULT_START_HOUR_BY_OCCASION: Record<string, string> = {
  date: '18:30',
  solo: '10:00',
  friends: '15:00',
};

export function buildItineraryFromTemplate(
  template: Template,
  candidates: Place[],
  inputs: PlanInputs,
  startTime?: string,
  usedAcrossBatch: Set<string> = new Set(),
  opts: { skipHoursFilter?: boolean; taste?: TasteContext } = {},
): Itinerary | null {
  const eligibleByType = candidates.filter((p) => p.is_active !== false);
  const picked: Place[] = [];

  // Need to know the slot start time BEFORE we can filter on hours.
  // So we walk the template once to compute each slot's start time, then
  // fill each slot using its real start.
  const slotStarts = computeSlotStarts(
    template,
    startTime ?? DEFAULT_START_HOUR_BY_OCCASION[inputs.occasion] ?? '18:00',
  );

  for (let i = 0; i < template.slots.length; i++) {
    const slot = template.slots[i];
    // skipHoursFilter is set on the relaxed-mode retry — passes a sentinel
    // empty start that placeMatchesSlot's isOpenAt treats as "open".
    const slotStart = opts.skipHoursFilter ? '' : slotStarts[i];
    const matching = eligibleByType
      .filter((p) => placeMatchesSlot(p, slot, slotStart))
      .map(
        (p) =>
          ({
            place: p,
            score: scorePlace(p, slot, inputs, picked, usedAcrossBatch, opts.taste),
          }) as ScoredPlace,
      )
      .sort((a, b) => b.score - a.score);

    const choice = pickFromTop(matching, 5);
    if (!choice) return null; // can't fill this template
    picked.push(choice.place);
  }

  // Build stops with real timing using whichever places actually got picked
  // (drive_to_next is computed below, after we know the picks).
  let cursor = startTime ?? DEFAULT_START_HOUR_BY_OCCASION[inputs.occasion] ?? '18:00';
  const stops: ItineraryStop[] = [];
  let totalCost = 0;

  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    const slot = template.slots[i];
    const dur = Math.min(slot.duration_min, p.typical_duration_min);
    const cost = p.typical_per_person ?? 0;
    const driveToNext = i < picked.length - 1
      ? estimateDriveMin(p, picked[i + 1])
      : undefined;

    stops.push({
      place_id: p.id,
      place_name: p.name,
      place_slug: p.slug,
      place_type: p.type,
      start_time: cursor,
      duration_min: dur,
      estimated_cost_pp: cost,
      drive_to_next_min: driveToNext,
      photo_url: p.photo_url,
      address: p.address,
      neighborhood: p.neighborhood,
      lat: p.lat,
      lng: p.lng,
      local_insight: p.local_insight,
      reservation_url: p.reservation_url,
      reservation_required: p.reservation_required,
    });

    totalCost += cost;
    cursor = addMinutes(cursor, dur + (driveToNext ?? 0));
  }

  // Sanity check budget — if over by >30%, return null. For very tight budgets
  // (e.g. "free" → 0) we still allow up to $50/pp floor so mostly-free nights
  // with one paid stop (a $$ dinner, a cocktail bar) can fill. People who pick
  // "Free" want cheap, not literally zero — otherwise we fail to plan anything.
  const budgetCeiling = Math.max(inputs.budget_per_person * 1.3, 50);
  if (totalCost > budgetCeiling) return null;

  // Sanity check vibe match — at least 50% of stops should match user vibe
  // No vibe-floor check anymore. Treat vibe as a PREFERENCE that biases
  // scoring (already does — +1.5 per overlap), not a hard requirement that
  // can fail the entire plan. Better to ship a slightly off-vibe plan than
  // ship nothing.

  return {
    template_id: template.id,
    template_name: template.name,
    title: '',          // filled by LLM writing pass
    hook: '',           // filled by LLM
    why_it_works: '',   // filled by LLM
    stops,
    total_cost_pp: totalCost,
    total_duration_min: stops.reduce((s, x) => s + x.duration_min + (x.drive_to_next_min ?? 0), 0),
    vibe: Array.from(new Set(picked.flatMap((p) => p.vibe_tags))).filter((v) =>
      inputs.vibe.includes(v)
    ),
  };
}

function estimateDriveMin(a: Place, b: Place): number {
  if (a.drive_cluster === b.drive_cluster) return 5;
  if (a.drive_cluster === 'multiple' || b.drive_cluster === 'multiple') return 10;
  // Cross-cluster: rough heuristic, real distance lookup would be Phase 6+
  return 20;
}

// Pre-compute the start time of each slot using template durations + a flat
// drive estimate. We don't know the actual picks yet (this runs BEFORE slot
// fill so we can hours-filter candidates). Real start times in the returned
// itinerary use real drive times.
function computeSlotStarts(template: Template, firstStart: string): string[] {
  const starts: string[] = [];
  let cursor = firstStart;
  for (let i = 0; i < template.slots.length; i++) {
    starts.push(cursor);
    const slot = template.slots[i];
    const flatDrive = i < template.slots.length - 1 ? 10 : 0;
    cursor = addMinutes(cursor, slot.duration_min + flatDrive);
  }
  return starts;
}

// ─── "One Weird Thing" delighter injection ─────────────────────────────
// After the main venues are selected, try to inject one surprise stop —
// a place tagged is_delighter (cheese shop, hidden rooftop, bookstore-bar,
// etc). Replaces the weakest-scored stop OR adds a bonus stop if the plan
// has room. Returns the delighter place if injected, null otherwise.

export interface DelighterResult {
  injected: boolean;
  delighter_place_id: string | null;
  replaced_place_id: string | null;
  action: 'replaced_weakest' | 'added_bonus' | 'skipped';
}

export function injectDelighter(
  itinerary: Itinerary,
  candidates: Place[],
  inputs: PlanInputs,
  usedInPlan: Set<string>,
  usedAcrossBatch: Set<string>,
): DelighterResult {
  const delighters = candidates.filter(
    (p) => p.is_delighter === true && !usedInPlan.has(p.id) && !usedAcrossBatch.has(p.id),
  );
  if (delighters.length === 0) {
    return { injected: false, delighter_place_id: null, replaced_place_id: null, action: 'skipped' };
  }

  // Pick the best-scoring delighter (vibe overlap + quality).
  const scored = delighters
    .map((d) => ({
      place: d,
      score: d.quality_score + d.feedback_score + vibeOverlap(d, inputs.vibe) * 1.5,
    }))
    .sort((a, b) => b.score - a.score);
  const pick = scored[0].place;

  // Find the weakest stop in the itinerary. Score each stop by its place's
  // quality + feedback to find the least compelling one.
  const stopScores = itinerary.stops.map((s) => {
    const place = candidates.find((c) => c.id === s.place_id);
    return {
      stop: s,
      score: place ? place.quality_score + place.feedback_score : 0,
    };
  });
  const weakest = stopScores.reduce((min, curr) => (curr.score < min.score ? curr : min), stopScores[0]);

  // Only replace if the delighter is meaningfully better than the weakest
  // stop (at least +2 score delta). Otherwise skip — don't force it.
  const delighterScore = pick.quality_score + pick.feedback_score;
  if (delighterScore <= weakest.score + 2) {
    return { injected: false, delighter_place_id: null, replaced_place_id: null, action: 'skipped' };
  }

  // Check budget: replacing shouldn't blow the budget.
  const weakestCost = weakest.stop.estimated_cost_pp;
  const delighterCost = pick.typical_per_person ?? 0;
  const newTotal = itinerary.total_cost_pp - weakestCost + delighterCost;
  const budgetCeiling = Math.max(inputs.budget_per_person * 1.3, 50);
  if (newTotal > budgetCeiling) {
    return { injected: false, delighter_place_id: null, replaced_place_id: null, action: 'skipped' };
  }

  // Replace the weakest stop with the delighter, preserving timing.
  const idx = itinerary.stops.indexOf(weakest.stop);
  const replacedId = weakest.stop.place_id;

  itinerary.stops[idx] = {
    place_id: pick.id,
    place_name: pick.name,
    place_slug: pick.slug,
    place_type: pick.type,
    start_time: weakest.stop.start_time,
    duration_min: Math.min(weakest.stop.duration_min, pick.typical_duration_min),
    estimated_cost_pp: delighterCost,
    drive_to_next_min: weakest.stop.drive_to_next_min,
    photo_url: pick.photo_url,
    address: pick.address,
    neighborhood: pick.neighborhood,
    lat: pick.lat,
    lng: pick.lng,
    local_insight: pick.local_insight,
    reservation_url: pick.reservation_url,
    reservation_required: pick.reservation_required,
  };

  itinerary.total_cost_pp = newTotal;
  usedInPlan.add(pick.id);
  usedAcrossBatch.add(pick.id);

  return {
    injected: true,
    delighter_place_id: pick.id,
    replaced_place_id: replacedId,
    action: 'replaced_weakest',
  };
}
