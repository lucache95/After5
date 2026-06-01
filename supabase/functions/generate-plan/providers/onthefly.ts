import type { DateGenerationProvider, GenerationContext } from './types.ts';
import { runPipeline, PipelineError } from './pipeline.ts';
import { searchText, googleResultToPlaceRow, passesQualityFloor, type GoogleResult } from '../google-places.ts';

// One Text Search per category. ~5 calls, parallelized. No Place Details, no
// per-place LLM (C6) — the stopgap warms cheaply; the real engine comes later.
const CATEGORIES = ['cafe', 'restaurant', 'bar', 'activity', 'park'];

// Cold-check threshold: if a city already has >= this many usable places we
// skip the Google round-trip entirely (keeps repeat generations cheap, C7).
// Heuristic — a city with a dozen vetted/auto spots can fill 3 itineraries.
const COLD_THRESHOLD = 12;

export function buildWarmRows(results: GoogleResult[], city: { id: string; slug: string }, key: string) {
  const seen = new Set<string>();
  const rows = [];
  for (const r of results) {
    if (!r.id || seen.has(r.id)) continue;
    if (!passesQualityFloor(r)) continue;
    seen.add(r.id);
    rows.push(googleResultToPlaceRow(r, city, key));
  }
  return rows;
}

export const OnTheFlyProvider: DateGenerationProvider = {
  name: 'onthefly',
  async generate(ctx: GenerationContext) {
    const { city, env, supabase } = ctx;
    if (!env.googleKey) {
      throw new PipelineError('generation_unavailable', 'On-the-fly generation is not configured for this city yet.', 503);
    }
    // Warm only if the city is cold (no auto/live places yet) — keeps repeat
    // generations cheap. (Count, not fetch.)
    const { count } = await supabase.from('places')
      .select('id', { count: 'exact', head: true })
      .eq('city_id', city.id).in('approval_status', ['live', 'auto']).eq('is_active', true);
    if ((count ?? 0) < COLD_THRESHOLD) {
      const queries = CATEGORIES.map((c) => `${c} in ${city.name} ${city.region ?? ''}`.trim());
      const settled = await Promise.allSettled(queries.map((q) =>
        searchText(q, { apiKey: env.googleKey!, lat: city.centroid_lat, lng: city.centroid_lng, radiusKm: city.default_radius_km })));
      const results: GoogleResult[] = [];
      for (const s of settled) if (s.status === 'fulfilled') results.push(...s.value);
      const rows = buildWarmRows(results, city, env.googleKey);
      if (rows.length > 0) {
        // Idempotent: upsert on google_place_id (C7).
        await supabase.from('places').upsert(rows, { onConflict: 'google_place_id', ignoreDuplicates: true });
      }
      ctx.log.warm = { city: city.slug, queried: queries.length, raw: results.length, inserted: rows.length };
    }
    // Reuse the shared pipeline, accepting freshly-warmed 'auto' rows.
    return runPipeline(ctx, { approvalStatuses: ['live', 'auto'] });
  },
};
