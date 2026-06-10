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
import { haversineKm } from './places-filter.ts';

// PLAN-01 (Area 1): max consecutive-hop distance for an itinerary. Tunable,
// named constant — ~2km is walkable / a short drive. Replaces the drive_cluster
// string-equality adjacency check (which couldn't generalize past curated
// Kelowna). drive_cluster stays for display but no longer gates adjacency.
export const MAX_HOP_KM = 2.0;

// ─── Experience groups (same-experience adjacency) ───────────────────────
// Map place_type → broad experience group so selection can avoid two
// near-identical experiences back-to-back (bakery → cafe is two sit-down
// coffee-ish stops in a row; cocktail bar → brewery is two drink stops).
// Cross-group adjacency (cafe → restaurant) is fine. Outdoor/view/activity
// types are deliberately ungrouped ('other') — repetition there reads as a
// theme, not a rut. Shared by the scorePlace penalty (selection time) and
// pipeline.ts fixAdjacency (post-assembly backstop).
export function categoryGroupForType(t: string | undefined | null): string {
  if (!t) return 'other';
  if (t === 'restaurant') return 'food';
  if (t === 'winery' || t === 'brewery' || t === 'cocktail_bar') return 'drink';
  if (t === 'cafe' || t === 'dessert' || t === 'ice_cream' || t === 'bakery') return 'sweet';
  return 'other';
}

export const ENFORCED_GROUPS: ReadonlySet<string> = new Set(['food', 'drink', 'sweet']);

// Penalty applied when a candidate shares an enforced experience group with the
// stop picked immediately before it. Sized to outweigh the usual tie-breakers
// (same-type -3, vibe overlaps at ±1.5 each, pairing ±1.5) so a close-scoring
// different-group candidate wins the slot, while staying well under the -100
// same-place wall — on a thin pool where ONLY same-group candidates exist, the
// slot still fills. A penalty, not a ban.
export const SAME_GROUP_ADJACENCY_PENALTY = 8;

// ─── Hard date-flow rules (product, 2026-06-10) ───────────────────────────
// 1. No cafes at/after 5pm. After5 is an evening product; coffee is a
//    morning/afternoon thing — a coffee-shop stop on a 7pm date reads wrong.
//    Hard filter (not a penalty), applied on the slot's REAL estimated start
//    even on the relaxed (hours-skipping) retry: relaxed mode exists to admit
//    null-HOURS venues in thin cities, not to re-admit evening coffee.
// 2. Max ONE 'sweet' stop per plan (cafe/bakery/dessert/ice_cream). The soft
//    adjacency penalty allowed dessert→coffee whenever the two weren't
//    consecutive (or the pool was thin) — two sit-down sugar stops is the
//    same date twice regardless of spacing.
export const EVENING_COFFEE_CUTOFF = '17:00';

export function cafeAllowedAt(slotStart: string): boolean {
  if (!slotStart) return true; // unknown time — cannot gate
  return toMinutes(slotStart) < toMinutes(EVENING_COFFEE_CUTOFF);
}

/** Hard product gate for one candidate against one slot. `pickedSoFar` are the
 * stops already chosen for THIS plan (any order/position). */
export function passesDateFlowRules(p: Place, realSlotStart: string, pickedSoFar: Place[]): boolean {
  if (p.type === 'cafe' && !cafeAllowedAt(realSlotStart)) return false;
  if (
    categoryGroupForType(p.type) === 'sweet' &&
    pickedSoFar.some((x) => categoryGroupForType(x.type) === 'sweet')
  ) {
    return false;
  }
  return true;
}

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
// DATA-03 fail-loud: null hours are NOT treated as always-open for a timed
// slot — a venue we can't hours-validate must not silently pass.
// Late-night closes (e.g. 01:00) are handled by allowing wraparound.
//
// CONTROL-FLOW ORDER MATTERS: relaxed mode (empty slotStart) is checked FIRST.
// The relaxed retry path deliberately admits null-hours venues so thin/cold
// cities can still fill an itinerary. Checking null-hours first would make a
// relaxed call return false on those venues and collapse the retry — the exact
// failure this phase prevents.
export function isOpenAt(p: Place, slotStart: string): boolean {
  // Empty slotStart = relaxed mode (skip hours filtering) — unchanged.
  if (!slotStart) return true;
  // Timed slot + unknown hours → EXCLUDE (was silently true). Fail loud.
  if (!p.opens || !p.closes) return false;
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

// PLAN-01 (Area 1): real haversine adjacency gate. Returns true when the
// candidate is within maxKm of the previous (consecutive) stop. DATA-03
// fail-loud: a stop with unknown coords is EXCLUDED (false), never silently
// passed — mirrors withinRadius's null→false convention. First stop (no prev)
// always passes. Replaces the drive_cluster string membership check.
export function withinHop(
  prev: Place | undefined,
  cand: Place,
  maxKm: number = MAX_HOP_KM,
): boolean {
  if (!prev) return true;
  if (
    typeof prev.lat !== 'number' || typeof prev.lng !== 'number' ||
    typeof cand.lat !== 'number' || typeof cand.lng !== 'number'
  ) {
    return false;
  }
  return haversineKm(prev.lat, prev.lng, cand.lat, cand.lng) <= maxKm;
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

  // Soft proximity signal: penalize a candidate that's a long hop from the
  // previous (consecutive) stop. Kept soft in the pick loop (not a hard reject)
  // so thin/cold pools can still fill a plan; the assembled itinerary is then
  // post-validated + repaired against MAX_HOP_KM (see buildItineraryFromTemplate).
  const prevPicked = alreadyPicked[alreadyPicked.length - 1];
  if (!withinHop(prevPicked, p)) score -= 5;

  // Same-experience adjacency: penalize a candidate whose experience group
  // (cafe-like / drink-like / food) matches the stop picked immediately before
  // it — a bakery right after a cafe is the same date twice. Soft penalty, not
  // a filter: a thin pool with only same-group candidates still fills the slot.
  // pipeline.ts fixAdjacency remains the post-assembly backstop.
  if (prevPicked) {
    const prevGroup = categoryGroupForType(prevPicked.type);
    if (ENFORCED_GROUPS.has(prevGroup) && categoryGroupForType(p.type) === prevGroup) {
      score -= SAME_GROUP_ADJACENCY_PENALTY;
    }
  }

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

  // Remember each slot's eligible candidates so the post-validate repair pass
  // can swap a far stop for the nearest in-slot alternative (PLAN-01).
  const slotMatches: ScoredPlace[][] = [];

  for (let i = 0; i < template.slots.length; i++) {
    const slot = template.slots[i];
    // skipHoursFilter is set on the relaxed-mode retry — passes a sentinel
    // empty start that placeMatchesSlot's isOpenAt treats as "open".
    const slotStart = opts.skipHoursFilter ? '' : slotStarts[i];
    const matching = eligibleByType
      .filter((p) => placeMatchesSlot(p, slot, slotStart))
      // Hard date-flow rules on the slot's REAL start (NOT the relaxed
      // sentinel): no evening cafes, max one sweet stop per plan.
      .filter((p) => passesDateFlowRules(p, slotStarts[i], picked))
      .map(
        (p) =>
          ({
            place: p,
            score: scorePlace(p, slot, inputs, picked, usedAcrossBatch, opts.taste),
          }) as ScoredPlace,
      )
      .sort((a, b) => b.score - a.score);

    slotMatches.push(matching);
    const choice = pickFromTop(matching, 5);
    if (!choice) return null; // can't fill this template
    picked.push(choice.place);
  }

  // ─── Post-validate + repair the consecutive-hop gate (PLAN-01) ─────────
  // The soft penalty in scorePlace biases toward proximity but doesn't guarantee
  // it on thin pools. Walk consecutive pairs; if a hop exceeds MAX_HOP_KM, swap
  // the far stop for the nearest in-slot candidate that's within hop of its
  // predecessor and not already used. Preserves plan availability while
  // guaranteeing the shipped plan passes the gate. Stops with null coords are
  // excluded by withinHop (fail-loud) and so are never accepted as a repair.
  repairFarHops(picked, slotMatches, usedAcrossBatch, slotStarts);

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
      // DATA-03: re-check THIS place's own hours at assembly. A null-hours
      // place can only have been admitted via the relaxed retry path (the timed
      // isOpenAt now excludes it), so unknown hours here = unverified open-state.
      // We re-derive it from the place rather than observe isOpenAt's internal
      // relaxed bypass, which is invisible to the assembler.
      unverified: (!p.opens || !p.closes),
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

// Post-validation repair: for each consecutive pair, if the hop exceeds
// MAX_HOP_KM, replace the far stop (index i) with the nearest in-slot candidate
// that is within hop of the previous stop and not already used elsewhere in the
// plan or batch. Mutates `picked` in place. If no in-slot candidate satisfies the
// hop (thin pool), the original far pick is kept — better a slightly far plan
// than no plan (the eval surfaces remaining far hops). null-coord candidates are
// rejected by withinHop, so they are never chosen as a repair.
function repairFarHops(
  picked: Place[],
  slotMatches: ScoredPlace[][],
  usedAcrossBatch: Set<string>,
  slotStarts: string[],
): void {
  for (let i = 1; i < picked.length; i++) {
    const prev = picked[i - 1];
    if (withinHop(prev, picked[i])) continue;

    const usedIds = new Set(picked.map((p) => p.id));
    // Date-flow context for a swap at slot i = every OTHER pick in the plan
    // (slotMatches[i] was only filtered against picks BEFORE slot i).
    const others = picked.filter((_, j) => j !== i);
    const candidates = (slotMatches[i] ?? [])
      .map((sp) => sp.place)
      .filter(
        (p) =>
          p.id !== picked[i].id &&
          !usedIds.has(p.id) &&
          !usedAcrossBatch.has(p.id) &&
          withinHop(prev, p) &&
          passesDateFlowRules(p, slotStarts[i] ?? '', others),
      );
    if (candidates.length === 0) continue; // can't repair — keep the far pick

    // Nearest in-slot candidate to the previous stop wins the swap.
    candidates.sort(
      (a, b) =>
        haversineKm(prev.lat as number, prev.lng as number, a.lat as number, a.lng as number) -
        haversineKm(prev.lat as number, prev.lng as number, b.lat as number, b.lng as number),
    );
    picked[i] = candidates[0];
  }
}

function estimateDriveMin(a: Place, b: Place): number {
  // PLAN-01: prefer real distance so the displayed drive time agrees with the
  // haversine hop-gate. Within MAX_HOP_KM = walkable/short (5 min); otherwise
  // scale ~30 km/h city driving. Falls back to the drive_cluster heuristic only
  // when coords are unknown (display-only; the gate itself excludes null coords).
  if (typeof a.lat === 'number' && typeof a.lng === 'number' &&
      typeof b.lat === 'number' && typeof b.lng === 'number') {
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
    if (km <= MAX_HOP_KM) return 5;
    return Math.max(5, Math.round((km / 30) * 60));
  }
  if (a.drive_cluster === b.drive_cluster) return 5;
  if (a.drive_cluster === 'multiple' || b.drive_cluster === 'multiple') return 10;
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

  // Hard date-flow rules also bind the delighter swap: no cafe sliding into an
  // evening slot, and no second sweet stop entering a plan that has one (the
  // stop being replaced doesn't count against the pick).
  const keptStops = itinerary.stops.filter((s) => s !== weakest.stop);
  const keptAsPlaces = keptStops.map((s) => ({ type: s.place_type }) as Place);
  if (!passesDateFlowRules(pick, weakest.stop.start_time, keptAsPlaces)) {
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
