// Combination scoring + greedy slot fill for v1.
// Goal: produce one strong itinerary per template without combinatorial explosion.
// We can upgrade to exhaustive search + diversity later.

import type { Place, PlanInputs, Template, TemplateSlot, Itinerary, ItineraryStop } from './types.ts';

interface ScoredPlace {
  place: Place;
  score: number;
}

function placeMatchesSlot(p: Place, slot: TemplateSlot): boolean {
  if (!slot.types.includes(p.type)) return false;
  if (slot.effort && slot.effort.length > 0 && !slot.effort.includes(p.effort)) return false;
  if (slot.price_tier && slot.price_tier.length > 0 && !slot.price_tier.includes(p.price_tier)) return false;
  if (slot.time_of_day && slot.time_of_day.length > 0) {
    const overlap = p.time_of_day.some((t) => slot.time_of_day!.includes(t));
    if (!overlap) return false;
  }
  if (slot.reservation_required === false && p.reservation_required === true) return false;
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

function scorePlace(p: Place, slot: TemplateSlot, inputs: PlanInputs, alreadyPicked: Place[]): number {
  let score = p.quality_score + p.feedback_score;
  score += vibeOverlap(p, inputs.vibe) * 1.5;
  score += pairingBonus(p, slot.prefers_pairing_tags);

  // Penalty for repeating the same place
  if (alreadyPicked.some((x) => x.id === p.id)) score -= 100;

  // Penalty for breaking cluster
  if (!clusterCompatible(alreadyPicked, p)) score -= 5;

  return score;
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
  startTime?: string
): Itinerary | null {
  const eligibleByType = candidates.filter((p) => p.is_active !== false);
  const picked: Place[] = [];

  // Greedy slot fill
  for (const slot of template.slots) {
    const matching = eligibleByType
      .filter((p) => placeMatchesSlot(p, slot))
      .map((p) => ({ place: p, score: scorePlace(p, slot, inputs, picked) }) as ScoredPlace)
      .sort((a, b) => b.score - a.score);

    const top = matching[0];
    if (!top) return null; // can't fill this template
    picked.push(top.place);
  }

  // Build stops with timing
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
