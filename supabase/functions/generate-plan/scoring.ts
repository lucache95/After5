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

import type { Place, PlanInputs, Template, TemplateSlot, Itinerary, ItineraryStop } from './types.ts';

interface ScoredPlace {
  place: Place;
  score: number;
}

// Returns true if the place's hours window covers the slot start time.
// `opens`/`closes` are nullable; null = unknown, treated as always-open.
// Late-night closes (e.g. 01:00) are handled by allowing wraparound.
function isOpenAt(p: Place, slotStart: string): boolean {
  if (!p.opens || !p.closes) return true;
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
    const slotStart = slotStarts[i];
    const matching = eligibleByType
      .filter((p) => placeMatchesSlot(p, slot, slotStart))
      .map(
        (p) =>
          ({
            place: p,
            score: scorePlace(p, slot, inputs, picked, usedAcrossBatch),
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
