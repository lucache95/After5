import type { DateGenerationProvider, GenerationContext, ProviderResult } from './types.ts';
import { PipelineError } from './pipeline-error.ts';
import { ONTHEFLY_APPROVAL_STATUSES } from '../places-filter.ts';
import { searchPlaces, type FsqResult } from '../foursquare.ts';
// FSQ_SEED_CATEGORY_IDS + buildWarmRows live in the SDK-free fsq-seed.ts so the
// async seed handler (process-jobs/seed-city.ts) shares the exact same category
// set + quality-floor + dedupe as this inline cold-start path. Re-exported here so
// existing importers of these symbols from onthefly.ts are unchanged.
export { FSQ_SEED_CATEGORY_IDS, buildWarmRows } from './fsq-seed.ts';
import { FSQ_SEED_CATEGORY_IDS, buildWarmRows } from './fsq-seed.ts';

// Per-category seed cap. RESEARCH Open Question 1: start at 30 (≤120/city), tune
// after the Phase-9 eval.
const SEED_LIMIT_PER_CATEGORY = 30;

// Cold-check threshold: if a city already has >= this many usable places we skip
// the Foursquare round-trip entirely (keeps repeat generations cheap, C7 / T-08-08).
const COLD_THRESHOLD = 12;

// Minimum usable candidates a warmed city needs before we trust it to fill a
// date. Below this the city is still "warming up" — surface a distinct state
// instead of a thin/garbage itinerary (Area 3, DATA-02).
const MIN_USABLE = 3;

// Injectable seam so the provider's control flow (env guard, cold-check, warm,
// city_warming fallback) is unit-testable without the prompt.ts → Anthropic-SDK
// import chain (no node_modules under plain `deno test`) and without a live key.
export interface OnTheFlyDeps {
  searchPlaces: typeof searchPlaces;
  runPipeline: (ctx: GenerationContext, opts?: { approvalStatuses?: string[] }) => Promise<ProviderResult>;
}

export async function generateOnTheFly(
  ctx: GenerationContext,
  deps: OnTheFlyDeps,
): Promise<ProviderResult> {
  const { city, env, supabase } = ctx;
  if (!env.foursquareKey) {
    throw new PipelineError('generation_unavailable', 'On-the-fly generation is not configured for this city yet.', 503);
  }

  // Warm only if the city is cold (no auto/live places yet) — keeps repeat
  // generations cheap. (Count, not fetch.)
  const { count } = await supabase.from('places')
    .select('id', { count: 'exact', head: true })
    .eq('city_id', city.id).in('approval_status', ['live', 'auto']).eq('is_active', true);
  const wasCold = (count ?? 0) < COLD_THRESHOLD;

  if (wasCold) {
    // One /places/search per top-level category id, parallelized. The new API
    // returns hours/photos/price/rating inline — no Place Details call (C6).
    const categoryIds = FSQ_SEED_CATEGORY_IDS.split(',');
    const settled = await Promise.allSettled(categoryIds.map((id) =>
      deps.searchPlaces({
        apiKey: env.foursquareKey!,
        lat: city.centroid_lat,
        lng: city.centroid_lng,
        radiusKm: city.default_radius_km,
        categoryIds: id,
        limit: SEED_LIMIT_PER_CATEGORY,
      })));
    const results: FsqResult[] = [];
    const searchErrors: string[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(...s.value);
      else searchErrors.push(String((s.reason as Error)?.message ?? s.reason));
    }
    const rows = buildWarmRows(results, city, env.foursquareKey);
    let upsertError: string | null = null;
    if (rows.length > 0) {
      // Idempotent: upsert on fsq_place_id (C7 / P5). Requires the NON-partial
      // unique index places_fsq_place_id_key (08-03). Surface any error into the
      // warm log instead of silently warming nothing.
      const { error } = await supabase.from('places').upsert(rows, { onConflict: 'fsq_place_id', ignoreDuplicates: true });
      if (error) upsertError = error.message;
    }
    ctx.log.warm = { city: city.slug, queried: categoryIds.length, raw: results.length, inserted: rows.length, searchErrors, upsertError };
  }

  // Reuse the shared pipeline, accepting freshly-warmed 'auto' rows on EVERY
  // generation (W3 — a background-seeded city must read its 'auto' rows too).
  try {
    return await deps.runPipeline(ctx, { approvalStatuses: [...ONTHEFLY_APPROVAL_STATUSES] });
  } catch (err) {
    // Area 3 (DATA-02): a city that is still thin after the inline warm surfaces a
    // DISTINCT city_warming (503) signal — "warming up, check back in a moment" —
    // NOT the generic no_candidates (422) and NEVER a garbage date. Only translate
    // when the city was just cold-warmed (an already-warm city's no_candidates is a
    // genuine filter miss, not a warming state).
    if (
      err instanceof PipelineError &&
      (err.code === 'no_candidates' || err.code === 'no_valid_itineraries') &&
      wasCold
    ) {
      throw new PipelineError(
        'city_warming',
        `We're still gathering great spots in ${city.name} — check back in a moment.`,
        503,
      );
    }
    throw err;
  }
}

export const OnTheFlyProvider: DateGenerationProvider = {
  name: 'onthefly',
  async generate(ctx: GenerationContext) {
    // Lazy import keeps the module top-level free of pipeline.ts → prompt.ts →
    // npm:@anthropic-ai/sdk, so the unit tests can import this file (for
    // buildWarmRows / generateOnTheFly via injected deps) without node_modules.
    const { runPipeline } = await import('./pipeline.ts');
    return generateOnTheFly(ctx, { searchPlaces, runPipeline });
  },
};

// MIN_USABLE referenced by the city_warming threshold doc; the pipeline's own
// `< 3` candidate gate (pipeline.ts) is the runtime enforcement we translate.
export { MIN_USABLE };
