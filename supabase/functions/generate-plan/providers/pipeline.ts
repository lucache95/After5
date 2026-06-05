// runPipeline — the shared generation pipeline, extracted verbatim from the
// old generate-plan/index.ts serve() (steps 3–7b). KelownaProvider and
// OnTheFlyProvider both call this; the ONLY difference between them is the
// approvalStatuses passed to filterPlaces (and on-the-fly warms the cache
// first). Behavior for Kelowna must be byte-identical to pre-M1.
//
// runPipeline returns { itineraries (post-LLM, post-photo-scrub), modPool,
// modifierIdsPicked }. Modifier selection lives here (it sits before the LLM
// pass in the original flow) and is handed to persist() by the handler. The
// pipeline also MUTATES ctx.log (the shared audit-log accumulator) so the
// handler can attach it on insert.

import { filterPlaces, coversAllMustIncludes } from '../places-filter.ts';
import { computeUnverifiedRate } from './unverified-rate.ts';
import { loadTemplates, selectTopTemplates } from '../templates.ts';
import { buildItineraryFromTemplate, injectDelighter } from '../scoring.ts';
import type { TasteContext } from '../scoring.ts';
import { writeItineraries } from '../prompt.ts';
import { selectPack, isSurpriseMe, packIsSatisfiable, enforceSequenceRules } from '../editorial-packs.ts';
import type { Itinerary, Place } from '../types.ts';
import type { GenerationContext, ProviderResult, ModifierRow } from './types.ts';
import { PipelineError } from './pipeline-error.ts';

// Re-export so existing `import { PipelineError } from './pipeline.ts'` callers
// (handler, KelownaProvider) keep working. The class itself moved to
// pipeline-error.ts so unit tests can import it without the Anthropic-SDK chain.
export { PipelineError };

export async function runPipeline(
  ctx: GenerationContext,
  opts?: { approvalStatuses?: string[] },
): Promise<ProviderResult> {
  const { inputs, city, supabase, env } = ctx;
  const sharedLog = ctx.log;
  const approvalStatuses = opts?.approvalStatuses ?? ['live'];

  // 3. Filter candidate places
  const candidates = await filterPlaces(supabase, inputs, city, approvalStatuses);
  if (candidates.length < 3) {
    throw new PipelineError('no_candidates', 'Not enough places match those filters. Try widening budget or vibe.', 422);
  }

  if (!coversAllMustIncludes(candidates, inputs.must_includes)) {
    throw new PipelineError('must_includes_unsatisfiable', 'No combination satisfies all must-includes for these inputs.', 422);
  }

  // 4. Load templates and pick top 3
  const allTemplates = await loadTemplates(supabase, inputs.occasion);
  const topTemplates = selectTopTemplates(allTemplates, inputs, 3);
  if (topTemplates.length === 0) {
    throw new PipelineError('no_template_match', 'No template matches those inputs.', 422);
  }

  // Audit log scaffold — populated as we go, attached to each itinerary
  // on insert. Lets us answer "why did this plan look like that?" without
  // re-running the function.
  sharedLog.inputs = inputs;
  sharedLog.candidate_pool_size = candidates.length;
  // DATA-03: share of the candidate pool with missing coords/hours. Set BEFORE
  // itinerary assembly so it is recorded even when assembly later fails — a
  // first-class Phase-9 eval signal flagging cold/thin cities reading "valid".
  sharedLog.unverified_rate = computeUnverifiedRate(candidates);
  sharedLog.templates_considered = allTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    slot_types: t.slots.map((s) => s.types[0]),
    satisfies_must_includes: true, // these survived the filter, by definition
  }));
  sharedLog.templates_selected = topTemplates.map((t) => t.id);

  // Slot-start time for hours filtering. The downstream scoring expects a
  // plain "HH:MM" string. Driven by time_of_day:
  //   morning / all_day → 10:00
  //   evening → 18:00
  // Explicit start_at overrides everything (legacy / API users).
  const effectiveStartAt = (() => {
    if (inputs.start_at) {
      const m = inputs.start_at.match(/T(\d{2}:\d{2})/);
      return m ? m[1] : '18:00';
    }
    if (inputs.time_of_day === 'morning' || inputs.time_of_day === 'all_day') return '10:00';
    return '18:00';
  })();

  // ─── 4b. Taste system setup ─────────────────────────────────────────
  // Query negative-space data: which venues appeared most in the last 7
  // days? Top 3 get a soft scoring penalty to prevent staleness.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const negativeSpacePenalties = new Map<string, number>();
  try {
    const { data: recentItins } = await supabase
      .from('itineraries')
      .select('stops')
      .gte('generated_at', sevenDaysAgo)
      .limit(200);

    if (recentItins && recentItins.length > 0) {
      const usageCounts = new Map<string, number>();
      for (const row of recentItins) {
        const stops = Array.isArray(row.stops) ? row.stops : [];
        for (const s of stops) {
          const pid = (s as { place_id?: string }).place_id;
          if (pid) usageCounts.set(pid, (usageCounts.get(pid) ?? 0) + 1);
        }
      }
      // Sort by usage, take top 3, assign descending penalties: -6, -4, -2
      const sorted = Array.from(usageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      const penalties = [6, 4, 2];
      sorted.forEach(([placeId], idx) => {
        negativeSpacePenalties.set(placeId, penalties[idx]);
      });
    }
  } catch (nsErr) {
    // Non-fatal — proceed without negative-space data
    console.error('[taste] negative-space query failed, proceeding without:', nsErr);
  }

  // Recency boost: active when user signals "trendy" / "new" / "adventurous"
  // or has intent = try_something_new.
  const RECENCY_VIBES = ['trendy', 'new', 'adventurous', 'modern', 'fresh'];
  const recencyBoostActive =
    inputs.intent === 'try_something_new' ||
    inputs.vibe.some((v) => RECENCY_VIBES.includes(v));

  // Editorial pack selection — match on inputs or random "surprise me".
  const surpriseMe = isSurpriseMe(inputs);
  let activePack = selectPack(inputs, surpriseMe);

  // Verify the pack is satisfiable with the current candidate pool
  if (activePack && !packIsSatisfiable(activePack, candidates)) {
    console.log(`[taste] pack "${activePack.name}" not satisfiable, falling back to default`);
    activePack = null;
  }

  const tasteContext: TasteContext = {
    negativeSpacePenalties,
    recencyBoostActive,
    pack: activePack,
  };

  sharedLog.taste = {
    negative_space_venues: Array.from(negativeSpacePenalties.entries()).map(([id, penalty]) => ({ id, penalty })),
    recency_boost_active: recencyBoostActive,
    editorial_pack: activePack ? { id: activePack.id, name: activePack.name } : null,
    surprise_me: surpriseMe,
  };

  // 5. Build one itinerary per template, tracking which place_ids have been
  //    used across the batch so each subsequent itinerary picks distinct
  //    spots (cross-plan diversity). Stochastic top-K inside scoring also
  //    means re-running the same inputs produces different plans.
  // Retry up to 3 times per template since stochastic top-5 can roll a
  // budget-busting combo. Almost always succeeds within 1-2 tries.
  const itineraries: Itinerary[] = [];
  const usedAcrossBatch = new Set<string>();

  function buildWithRetry(t: typeof topTemplates[number]): Itinerary | null {
    // First 3 attempts: strict (with hours filter). If they all fail —
    // usually because the time-of-day filter is too tight (cocktail bars
    // at 10am, cafes at 9pm, etc.) — try once more without the hours
    // filter so the user always gets *something* rather than a 422.
    for (let attempt = 0; attempt < 3; attempt++) {
      const it = buildItineraryFromTemplate(t, candidates, inputs, effectiveStartAt, usedAcrossBatch, { taste: tasteContext });
      if (it) return it;
    }
    const relaxed = buildItineraryFromTemplate(t, candidates, inputs, effectiveStartAt, usedAcrossBatch, { skipHoursFilter: true, taste: tasteContext });
    if (relaxed) return relaxed;
    return null;
  }

  for (const t of topTemplates) {
    const it = buildWithRetry(t);
    if (it) {
      itineraries.push(it);
      for (const stop of it.stops) usedAcrossBatch.add(stop.place_id);
    }
  }
  if (itineraries.length === 0) {
    throw new PipelineError('no_valid_itineraries', 'Could not assemble valid itineraries from the candidate pool.', 422);
  }

  // If we got fewer than 3 valid itineraries, try the remaining templates
  if (itineraries.length < 3 && allTemplates.length > topTemplates.length) {
    const remaining = allTemplates.filter((t) => !topTemplates.some((tt) => tt.id === t.id));
    for (const t of remaining) {
      if (itineraries.length >= 3) break;
      const it = buildWithRetry(t);
      if (it) {
        itineraries.push(it);
        for (const stop of it.stops) usedAcrossBatch.add(stop.place_id);
      }
    }
  }

  // 5b. "One Weird Thing" — try to inject a delighter stop into each
  //     itinerary. Replaces the weakest stop if a tagged delighter is
  //     meaningfully better. Non-destructive: skips if no delighters exist
  //     or if injection would blow the budget.
  const delighterResults: Array<{ template_id: string; action: string; delighter_id: string | null; replaced_id: string | null }> = [];
  for (const it of itineraries) {
    const usedInPlan = new Set(it.stops.map((s) => s.place_id));
    const result = injectDelighter(it, candidates, inputs, usedInPlan, usedAcrossBatch);
    if (result.injected || result.action !== 'skipped') {
      delighterResults.push({
        template_id: it.template_id,
        action: result.action,
        delighter_id: result.delighter_place_id,
        replaced_id: result.replaced_place_id,
      });
    }
  }
  if (delighterResults.length > 0) {
    sharedLog.delighter_results = delighterResults;
  }

  // 5c. Enforce editorial pack sequence rules (e.g. "last stop must be a
  //     view spot" for the Sunset Date pack). Runs after delighter injection
  //     so the delighter doesn't clobber a rule-required position.
  if (activePack && activePack.sequence_rules.length > 0) {
    const seqFixes: Array<{ template_id: string; swaps: number }> = [];
    for (const it of itineraries) {
      const swaps = enforceSequenceRules(activePack, it.stops, candidates);
      if (swaps > 0) seqFixes.push({ template_id: it.template_id, swaps });
    }
    if (seqFixes.length > 0) sharedLog.pack_sequence_fixes = seqFixes;
  }

  // 5e. Adjacency validator — no two stops in the same category_group
  //     back-to-back (no two bars, no two cafes). Tries to swap one of the
  //     offending stops with a candidate from a different group; if that
  //     fails, leaves the plan and logs the violation so we can audit.
  const adjacencyFixes: Array<{ template_id: string; before: string[]; after: string[]; swaps: number }> = [];
  for (const it of itineraries) {
    const before = it.stops.map((s) => s.place_name);
    const swaps = fixAdjacency(it, candidates, usedAcrossBatch);
    if (swaps > 0) {
      adjacencyFixes.push({
        template_id: it.template_id,
        before,
        after: it.stops.map((s) => s.place_name),
        swaps,
      });
    }
  }

  sharedLog.adjacency_fixes = adjacencyFixes;

  // 6. Pick a Wow-Factor modifier per itinerary. Different modifier per
  //    plan so the 3 returned itineraries each have their own twist.
  const { data: modPool } = await supabase
    .from('modifiers')
    .select('id, label, body, difficulty, vibe_affinity, occasion_affinity')
    .eq('is_active', true)
    .contains('occasion_affinity', [inputs.occasion]);
  const modifierIdsPicked: (string | null)[] = pickModifiersForBatch(
    (modPool ?? []) as ModifierRow[],
    inputs.vibe,
    itineraries.length,
  );

  // 7. LLM writing pass
  const placesById = new Map<string, Place>(candidates.map((p) => [p.id, p]));
  const writeResult = await writeItineraries(
    env.anthropicKey,
    env.anthropicModel,
    {
      inputs,
      itineraries,
      placesById,
      packVoiceNote: activePack?.voice_note ?? null,
      city: { name: city.name, region: city.region },
    }
  );
  const written = writeResult.itineraries;

  // 7a. Alert if deterministic fallback was used for what_to_do.
  // This means both the initial LLM pass and the retry failed to produce
  // copy for these stops — worth investigating the prompt or place data.
  if (writeResult.fallback_count > 0) {
    console.error(
      `[generate-plan] FALLBACK: ${writeResult.fallback_count} stop(s) used deterministic what_to_do fallback after LLM retry. ` +
      `Affected stops: ${writeResult.fallback_stops.map((s) => `${s.place_name} (${s.place_id})`).join(', ')}`
    );
    sharedLog.what_to_do_fallbacks = writeResult.fallback_stops;
  }

  // 7b. Scrub photos that don't match the season or stop time.
  // Drops snow shots in non-winter; drops daytime shots at evening stops.
  // Setting photo_url to null lets the frontend fall back to the type-based
  // image (handled by lib/place-image.ts on the client).
  const nowMonth0 = new Date().getMonth();
  const seasonNow =
    nowMonth0 >= 2 && nowMonth0 <= 4 ? 'spring' :
    nowMonth0 >= 5 && nowMonth0 <= 7 ? 'summer' :
    nowMonth0 >= 8 && nowMonth0 <= 10 ? 'fall' : 'winter';

  let photosScrubbed = 0;
  for (const it of written) {
    for (const stop of it.stops) {
      if (!stop.photo_url) continue;
      const place = placesById.get(stop.place_id);
      if (!place) continue;

      const startHour = parseInt(stop.start_time.split(':')[0] ?? '0', 10);
      const isEveningStop = startHour >= 19;

      // Reason 1: snow visible AND we're not in winter
      const isStaleSnow = place.photo_has_snow === true && seasonNow !== 'winter';
      // Reason 2: bright daytime photo at an evening stop
      const isWrongTime = isEveningStop && place.photo_time_of_day === 'day';

      if (isStaleSnow || isWrongTime) {
        stop.photo_url = null;
        photosScrubbed += 1;
      }
    }
  }
  if (photosScrubbed > 0) {
    sharedLog.photos_scrubbed = photosScrubbed;
  }

  return { itineraries: written, modPool: (modPool ?? []) as ModifierRow[], modifierIdsPicked };
}

// Pick N distinct modifiers for the batch, weighted by vibe overlap so each
// plan tends to get a Wow-Factor that matches its mood. Random tie-break, so
// repeat generations vary. If the pool is exhausted, falls back to nulls.
function pickModifiersForBatch(
  pool: Array<{ id: string; vibe_affinity?: string[] }>,
  userVibe: string[],
  count: number,
): (string | null)[] {
  const remaining = [...pool];
  const picked: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    if (remaining.length === 0) {
      picked.push(null);
      continue;
    }
    // Score by vibe overlap; weighted random across top half.
    const scored = remaining
      .map((m) => ({
        id: m.id,
        score:
          (m.vibe_affinity ?? []).filter((v) => userVibe.includes(v)).length * 3 +
          Math.random(),
      }))
      .sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, Math.max(1, Math.floor(scored.length / 2)));
    const choice = topK[Math.floor(Math.random() * topK.length)];
    picked.push(choice.id);
    const idx = remaining.findIndex((m) => m.id === choice.id);
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return picked;
}

// Map place_type → broad category so we can detect adjacency violations.
// Adjacent stops in the same group feel monotonous (two bars in a row,
// two cafes back-to-back). Cross-group adjacency (cafe → restaurant) is
// fine. Outdoor/view/activity are not enforced — feeling fresh outside
// matters less than the food/drink/sweet rhythm.
function categoryGroupForType(t: string | undefined | null): string {
  if (!t) return 'other';
  if (t === 'restaurant') return 'food';
  if (t === 'winery' || t === 'brewery' || t === 'cocktail_bar') return 'drink';
  if (t === 'cafe' || t === 'dessert' || t === 'ice_cream' || t === 'bakery') return 'sweet';
  return 'other';
}

const ENFORCED_GROUPS = new Set(['food', 'drink', 'sweet']);

// Walks the stops list, finds adjacent pairs in the same enforced category
// group, and tries to swap the second stop with a candidate from the same
// place_type but a different group (e.g. swap a 2nd cocktail bar for a
// brewery — same drink-vibe slot but different sub-group). Returns the
// number of successful swaps. Mutates `it.stops` in place.
function fixAdjacency(
  it: Itinerary,
  candidates: Place[],
  used: Set<string>,
): number {
  let swaps = 0;
  for (let i = 1; i < it.stops.length; i++) {
    const a = it.stops[i - 1];
    const b = it.stops[i];
    const ga = categoryGroupForType(a.place_type);
    const gb = categoryGroupForType(b.place_type);
    if (!ENFORCED_GROUPS.has(ga) || ga !== gb) continue;
    // Find a candidate that matches the original slot's place_type loosely
    // (any non-conflicting type from candidates, not already used in this
    // plan, and from a different category group than the previous stop).
    const used_in_plan = new Set(it.stops.map((s) => s.place_id));
    const swap = candidates.find((p) => {
      if (used_in_plan.has(p.id)) return false;
      if (used.has(p.id)) return false;
      const gp = categoryGroupForType(p.type);
      // Different group from previous stop, AND different from next stop if
      // there is one (avoid creating a new adjacency violation downstream).
      if (gp === ga) return false;
      const next = it.stops[i + 1];
      if (next) {
        const gn = categoryGroupForType(next.place_type);
        if (ENFORCED_GROUPS.has(gp) && gp === gn) return false;
      }
      return true;
    });
    if (!swap) continue;
    // Perform the swap. Preserve b's start_time + duration_min so the
    // schedule doesn't shift; the LLM writing pass re-renders what_to_do
    // downstream from the new place. estimated_cost_pp comes from the
    // swap's typical_per_person (or 0 if unknown).
    it.stops[i] = {
      place_id: swap.id,
      place_name: swap.name,
      place_slug: swap.slug,
      place_type: swap.type,
      start_time: b.start_time,
      duration_min: b.duration_min,
      drive_to_next_min: b.drive_to_next_min,
      estimated_cost_pp: swap.typical_per_person ?? 0,
      neighborhood: swap.neighborhood,
      lat: swap.lat,
      lng: swap.lng,
      address: swap.address ?? null,
      photo_url: swap.photo_url ?? null,
      local_insight: swap.local_insight ?? null,
      reservation_required: swap.reservation_required ?? false,
      reservation_url: swap.reservation_url ?? null,
    };
    used.add(swap.id);
    swaps += 1;
  }
  return swaps;
}
