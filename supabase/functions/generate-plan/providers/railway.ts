import type { DateGenerationProvider, GenerationContext } from './types.ts';
import type { Itinerary } from '../types.ts';
import { PipelineError } from './pipeline.ts';

// STUB — not selected by feature_config yet. Returns the same Itinerary[] shape
// the owner's Railway engine must produce (generate-plan/types.ts). When live,
// the handler persists the result identically to the other providers.
export const RailwayProvider: DateGenerationProvider = {
  name: 'railway',
  async generate(ctx: GenerationContext) {
    const { env, inputs, city } = ctx;
    if (!env.railwayUrl) {
      throw new PipelineError('generation_unavailable', 'Railway generator not configured.', 503);
    }
    const res = await fetch(env.railwayUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.railwayToken ? { authorization: `Bearer ${env.railwayToken}` } : {}) },
      body: JSON.stringify({ inputs, city: { slug: city.slug, name: city.name, region: city.region } }),
    });
    if (!res.ok) {
      throw new PipelineError('railway_error', `Railway ${res.status}`, 502);
    }
    const body = await res.json() as { itineraries: Itinerary[] };
    // Railway returns Itinerary[]; modifiers/modPool are pipeline-only, so empty here.
    return { itineraries: body.itineraries, modPool: [], modifierIdsPicked: body.itineraries.map(() => null) };
  },
};
