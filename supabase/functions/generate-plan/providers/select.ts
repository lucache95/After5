import type { DateGenerationProvider } from './types.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { KelownaProvider } from './kelowna.ts';
import { OnTheFlyProvider } from './onthefly.ts';
import { RailwayProvider } from './railway.ts';

export type ProviderMap = Record<string, string>;

const REGISTRY: Record<string, DateGenerationProvider> = {
  kelowna: KelownaProvider,
  onthefly: OnTheFlyProvider,
  railway: RailwayProvider,
};

// Parse the feature_config 'generation_providers' value into a clean
// city→provider map. Tolerates junk (null, strings, arrays, non-string
// values) by returning {} / skipping bad entries — selection then falls back
// to the hard default.
export function parseProviderMap(value: unknown): ProviderMap {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: ProviderMap = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  return {};
}

// Resolve a provider name: explicit city entry wins, else "_default", else
// the hard fallback 'kelowna' (the safe, curated path).
export function resolveProviderName(citySlug: string, map: ProviderMap): string {
  return map[citySlug] ?? map._default ?? 'kelowna';
}

export async function selectProvider(citySlug: string, supabase: SupabaseClient): Promise<DateGenerationProvider> {
  const { data } = await supabase.from('feature_config').select('value').eq('key', 'generation_providers').maybeSingle();
  const map = parseProviderMap((data as { value?: unknown } | null)?.value);
  const name = resolveProviderName(citySlug, map);
  return REGISTRY[name] ?? KelownaProvider;
}
