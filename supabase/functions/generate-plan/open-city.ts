// open-city — resolve a free-text city query into a CityRecord the existing
// pipeline can consume, WITHOUT touching the frozen city_slug path.
//
// Flow (only runs when a request sends `city_query` and city_slug didn't
// resolve to a real cities row):
//   1. geocode the typed string (Foursquare places/search `near` → center + radius)
//   2. upsert a deterministic ad-hoc cities row (slug = "open-<slug>") with
//      is_active = false so it never leaks into the public city list
//   3. return its CityRecord
// The on-the-fly provider then warms places around that center exactly as it
// does for any city. Curated city_slug callers never reach this file.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { CityRecord } from './types.ts';
import { geocodeCity } from './foursquare.ts';
import { slugify } from './google-places.ts';

// Deterministic slug for an ad-hoc city so repeat generations reuse one row
// (idempotent on conflict) instead of spawning a new city per request. Prefixed
// "open-" to keep ad-hoc cities visibly distinct from curated slugs.
export function openCitySlug(query: string): string {
  const base = slugify(query) || 'city';
  return `open-${base}`.slice(0, 60);
}

// Short display name from a Google formatted address — first segment, title-ish.
// "Portland, OR, USA" → "Portland". Falls back to the raw query.
export function displayNameFromGeocode(name: string, query: string): string {
  const first = name.split(',')[0]?.trim();
  return first && first.length > 0 ? first : query.trim();
}

export class OpenCityError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = 'OpenCityError';
  }
}

// Resolve (geocode + upsert) an ad-hoc city for a free-text query. Throws
// OpenCityError on no API key (503) or an ungeocodable query (422).
export async function resolveOpenCity(
  query: string,
  supabase: SupabaseClient,
  opts: { fsqKey?: string },
): Promise<CityRecord> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new OpenCityError('unknown_city', 'Type a city to build a night.', 422);
  }
  if (!opts.fsqKey) {
    throw new OpenCityError('generation_unavailable', 'Open-city generation is not configured yet.', 503);
  }

  const slug = openCitySlug(trimmed);

  // Reuse an existing ad-hoc row if we already geocoded this query — skips the
  // Google round-trip and keeps warmed places attached to one city_id.
  const { data: existing } = await supabase
    .from('cities')
    .select('id,slug,name,region,timezone,centroid_lat,centroid_lng,default_radius_km')
    .eq('slug', slug)
    .maybeSingle();
  if (existing && (existing as CityRecord).centroid_lat != null) {
    return existing as CityRecord;
  }

  const geo = await geocodeCity(trimmed, { apiKey: opts.fsqKey });
  if (!geo) {
    throw new OpenCityError('unknown_city', `Couldn't find "${trimmed}". Try a city, state.`, 422);
  }

  const name = displayNameFromGeocode(geo.name, trimmed);
  const row = {
    slug,
    name,
    region: geo.name, // display name echoed back from the geocode as the region hint
    timezone: 'UTC', // scheduling uses explicit start_at / time_of_day, not city tz
    centroid_lat: geo.lat,
    centroid_lng: geo.lng,
    default_radius_km: geo.radiusKm,
    is_active: false, // ad-hoc: must NOT surface in the public city list
  };

  // Upsert on the unique slug so concurrent requests for the same query
  // converge on one row. Select the canonical record back.
  const { data: upserted, error } = await supabase
    .from('cities')
    .upsert(row, { onConflict: 'slug' })
    .select('id,slug,name,region,timezone,centroid_lat,centroid_lng,default_radius_km')
    .maybeSingle();
  if (error || !upserted) {
    throw new OpenCityError('internal', `Couldn't create city: ${error?.message ?? 'unknown'}`, 500);
  }
  return upserted as CityRecord;
}
