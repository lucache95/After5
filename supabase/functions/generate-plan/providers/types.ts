import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Itinerary, PlanInputs, CityRecord } from '../types.ts';

// Env the providers + pipeline read. anthropicKey/anthropicModel are always
// present (the function has always had them); google/railway are optional and
// only needed by the on-the-fly / railway paths (C5).
export interface GenerationEnv {
  anthropicKey: string;
  anthropicModel: string;
  googleKey?: string;
  foursquareKey?: string;
  railwayUrl?: string;
  railwayToken?: string;
}

export interface GenerationContext {
  inputs: PlanInputs;
  city: CityRecord;
  supabase: SupabaseClient;
  env: GenerationEnv;
  log: Record<string, unknown>; // sharedLog accumulator (mutated by the pipeline)
}

// A modifier row as loaded from the `modifiers` table — kept loose because
// persist only needs id/label/body/difficulty.
export interface ModifierRow {
  id: string;
  label: string;
  body: string;
  difficulty: string;
  vibe_affinity?: string[];
  occasion_affinity?: string[];
}

// The seam boundary: providers return the post-LLM Itinerary[] PLUS the
// modifier selection (pipeline-only state) so the handler can persist
// identically across providers. Railway returns empty modifier state.
export interface ProviderResult {
  itineraries: Itinerary[];
  modPool: ModifierRow[];
  modifierIdsPicked: (string | null)[];
}

export interface DateGenerationProvider {
  readonly name: string;
  generate(ctx: GenerationContext): Promise<ProviderResult>;
}
