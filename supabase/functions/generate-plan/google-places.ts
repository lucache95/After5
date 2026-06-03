// Google Places (New) — pure mappers + a thin Text Search fetch, ported from
// apps/web/scripts/discover-places.mjs (verbatim logic, typed for Deno).
//
// The on-the-fly cache-warmer uses these to turn Google results into `places`
// rows. We deliberately DROP the per-place LLM augment the discovery script
// runs — the stopgap warms cheaply and lets the real generation engine ship
// later. Subjective fields get neutral defaults.

// Google's primary types (varies wildly) → our `place_type` enum.
// First match wins. Anything unmatched falls back to 'activity' as a catch-all.
export function mapGoogleTypes(googleTypes: string[]): string {
  const set = new Set(googleTypes);
  const rules: { ours: string; match: string[] }[] = [
    { ours: 'winery',        match: ['winery'] },
    { ours: 'brewery',       match: ['brewery'] },
    { ours: 'cocktail_bar',  match: ['bar', 'night_club'] },
    { ours: 'cafe',          match: ['cafe', 'coffee_shop'] },
    { ours: 'bakery',        match: ['bakery'] },
    { ours: 'ice_cream',     match: ['ice_cream_shop'] },
    { ours: 'dessert',       match: ['dessert_shop', 'dessert_restaurant'] },
    { ours: 'restaurant',    match: ['restaurant', 'meal_takeaway', 'meal_delivery', 'food'] },
    { ours: 'gallery',       match: ['art_gallery'] },
    { ours: 'beach',         match: ['beach'] },
    { ours: 'park',          match: ['park', 'national_park'] },
    { ours: 'garden',        match: ['botanical_garden'] },
    { ours: 'hike',          match: ['hiking_area', 'trail'] },
    { ours: 'viewpoint',     match: ['scenic_lookout', 'observation_deck'] },
    { ours: 'sunset_spot',   match: [] }, // human-tagged
    { ours: 'walk',          match: ['promenade'] },
    { ours: 'market',        match: ['market', 'farmers_market'] },
    { ours: 'shop',          match: ['store', 'clothing_store', 'gift_shop'] },
    { ours: 'activity',      match: ['amusement_park', 'bowling_alley', 'spa', 'tourist_attraction', 'museum'] },
  ];
  for (const r of rules) {
    if (r.match.some((t) => set.has(t))) return r.ours;
  }
  return 'activity';
}

export function priceLevelToTier(level: string | undefined): string {
  // Google: PRICE_LEVEL_FREE=0, INEXPENSIVE=1, MODERATE=2, EXPENSIVE=3, VERY_EXPENSIVE=4
  if (level === 'PRICE_LEVEL_FREE' || level === 'PRICE_LEVEL_INEXPENSIVE') return '$';
  if (level === 'PRICE_LEVEL_MODERATE') return '$$';
  if (level === 'PRICE_LEVEL_EXPENSIVE' || level === 'PRICE_LEVEL_VERY_EXPENSIVE') return '$$$';
  return '$$';
}

// Rough neighborhood bucketing from lat/lng. Tuned to Kelowna; for other
// cities it degrades to 'downtown'/'multiple' which is harmless — these are
// soft labels only used for the drive_cluster grouping.
export function neighborhoodFromLatLng(lat: number | null, lng: number | null): string {
  if (!lat || !lng) return 'multiple';
  if (lng < -119.55) return 'west_kelowna';
  if (lat > 50.0) return 'lake_country';
  if (lat < 49.78) return 'peachland';
  if (lat < 49.82 && lng > -119.46) return 'south_east_kelowna';
  if (lat < 49.85) return 'lower_mission';
  if (lat > 49.91 && lng > -119.45) return 'rutland';
  if (lat > 49.91) return 'glenmore';
  return 'downtown';
}

export function driveClusterFromNeighborhood(n: string): string {
  if (['downtown', 'lakeshore'].includes(n)) return 'downtown';
  if (['lower_mission', 'pandosy', 'south_east_kelowna'].includes(n)) return 'mission';
  if (['rutland', 'glenmore'].includes(n)) return 'north_east';
  if (n === 'west_kelowna') return 'west';
  if (n === 'lake_country') return 'lake_country';
  if (n === 'peachland') return 'peachland';
  return 'multiple';
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function buildPhotoUrl(photoResource: string, googleKey: string): string {
  return `https://places.googleapis.com/v1/${photoResource}/media?maxWidthPx=1200&key=${googleKey}`;
}

export function pickHours(
  opening: { weekdayDescriptions?: string[] } | null,
): { opens: string | null; closes: string | null } {
  if (!opening?.weekdayDescriptions) return { opens: null, closes: null };
  // Try Wednesday (a typical day) — first time range we can parse.
  // Format: "Wednesday: 11:00 AM – 10:00 PM"
  const wed = opening.weekdayDescriptions.find((d) => d.startsWith('Wednesday')) ?? opening.weekdayDescriptions[2];
  if (!wed) return { opens: null, closes: null };
  const m = wed.match(/(\d{1,2}):?(\d{2})?\s?(AM|PM)\s*[–-]\s*(\d{1,2}):?(\d{2})?\s?(AM|PM)/i);
  if (!m) return { opens: null, closes: null };
  const to24 = (h: string, mm: string | undefined, ap: string) => {
    let hour = parseInt(h, 10) % 12;
    if (ap.toUpperCase() === 'PM') hour += 12;
    return `${String(hour).padStart(2, '0')}:${(mm ?? '00').padStart(2, '0')}`;
  };
  return { opens: to24(m[1], m[2], m[3]), closes: to24(m[4], m[5], m[6]) };
}

export interface GoogleResult {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  viewport?: {
    low?: { latitude?: number; longitude?: number };
    high?: { latitude?: number; longitude?: number };
  };
  types?: string[];
  priceLevel?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  photos?: { name: string }[];
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  websiteUri?: string;
}

// ─── Geocoding (open-city) ──────────────────────────────────────────────
// Turn a free-text city/state string into a center + radius using the SAME
// Places Text Search endpoint + key the warmer already uses (no second Google
// API to enable). We bias the search to localities, read the top result's
// `location` (center) and `viewport` (bounding box), and derive a radius from
// the box so the warmer covers the city without overreaching.

export interface GeocodedCity {
  lat: number;
  lng: number;
  radiusKm: number;
  /** Cleaned display name Google echoes back (e.g. "Portland, OR, USA"). */
  name: string;
}

// Haversine distance in km between two lat/lng points.
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Derive a warm radius (km) from a Google viewport. Half the box diagonal
// covers the locality; clamp to a sane band so a tiny town still gets a useful
// search and a sprawling metro doesn't pull in three counties.
export function radiusFromViewport(vp: GoogleResult['viewport']): number {
  const lowLat = vp?.low?.latitude;
  const lowLng = vp?.low?.longitude;
  const highLat = vp?.high?.latitude;
  const highLng = vp?.high?.longitude;
  if (lowLat == null || lowLng == null || highLat == null || highLng == null) {
    return 25; // no viewport → a reasonable default
  }
  const diagKm = haversineKm(lowLat, lowLng, highLat, highLng);
  const radius = Math.round(diagKm / 2);
  return Math.min(60, Math.max(8, radius));
}

// Geocode one free-text city query. Returns null when the query yields no
// usable result (caller surfaces a clean error). Reuses the Places Text Search
// endpoint with a locality-leaning field mask.
export async function geocodeCity(query: string, opts: { apiKey: string }): Promise<GeocodedCity | null> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': opts.apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.viewport',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`Google geocode ${res.status}: ${await res.text()}`);
  const top = ((await res.json()).places ?? [])[0] as GoogleResult | undefined;
  const lat = top?.location?.latitude;
  const lng = top?.location?.longitude;
  if (top == null || lat == null || lng == null) return null;
  return {
    lat,
    lng,
    radiusKm: radiusFromViewport(top.viewport),
    name: top.formattedAddress ?? top.displayName?.text ?? query,
  };
}

export function passesQualityFloor(r: { rating?: number; userRatingCount?: number; businessStatus?: string }): boolean {
  return (r.rating ?? 0) >= 4.0
    && (r.userRatingCount ?? 0) >= 20
    && r.businessStatus === 'OPERATIONAL';
}

export interface CityForMapping { id: string; slug: string; }

export function googleResultToPlaceRow(r: GoogleResult, city: CityForMapping, googleKey: string) {
  const lat = r.location?.latitude ?? null;
  const lng = r.location?.longitude ?? null;
  // neighborhoodFromLatLng's buckets are Kelowna-only — applying them to another
  // city mislabels every venue (e.g. Vancouver coords → 'west_kelowna'), which then
  // leaks into the LLM copy. For non-Kelowna (on-the-fly) cities, label the
  // neighborhood with the city slug instead until a real geocoder lands (Railway).
  const neighborhood = city.slug === 'kelowna' ? neighborhoodFromLatLng(lat, lng) : city.slug;
  const driveCluster = city.slug === 'kelowna' ? driveClusterFromNeighborhood(neighborhood) : 'multiple';
  const type = mapGoogleTypes(r.types ?? []);
  const photoResource = r.photos?.[0]?.name;
  const hours = pickHours(r.regularOpeningHours ?? null);
  const name = r.displayName?.text ?? 'Unknown';
  return {
    name,
    slug: `${slugify(name || r.id)}-${r.id.slice(-6).toLowerCase()}`,
    address: r.formattedAddress ?? null,
    neighborhood,
    drive_cluster: driveCluster,
    type,
    // No per-place LLM augment in the stopgap — neutral defaults.
    vibe_tags: [] as string[],
    pairing_tags: [] as string[],
    effort: 'low',
    energy: 'medium',
    time_of_day: [] as string[],
    weather_dependent: false,
    seasonality: ['year_round'],
    typical_duration_min: 60,
    opens: hours.opens,
    closes: hours.closes,
    price_tier: priceLevelToTier(r.priceLevel),
    typical_per_person: null as number | null,
    reservation_required: false,
    reservation_url: r.websiteUri ?? null,
    photo_url: photoResource ? buildPhotoUrl(photoResource, googleKey) : null,
    google_place_id: r.id,
    lat,
    lng,
    quality_score: r.rating ? Math.min(10, Math.round(r.rating * 2)) : 7,
    feedback_score: 0,
    local_insight: null as string | null,
    notes: null as string | null,
    is_active: true,
    approval_status: 'auto' as const,
    source: 'discovered' as const,
    city_id: city.id,
    discovered_at: new Date().toISOString(),
  };
}

// Thin Text Search fetch, ported from discover-places.mjs `googleSearchText`,
// parameterized by city centroid + radius + API key. Field mask matches the
// script plus `places.businessStatus` (needed for the quality floor).
export async function searchText(query: string, opts: {
  apiKey: string; lat: number; lng: number; radiusKm: number;
}): Promise<GoogleResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': opts.apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.priceLevel,places.rating,places.userRatingCount,places.businessStatus,places.photos,places.regularOpeningHours,places.websiteUri',
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      locationBias: { circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: opts.radiusKm * 1000 } },
    }),
  });
  if (!res.ok) throw new Error(`Google searchText ${res.status}: ${await res.text()}`);
  return ((await res.json()).places ?? []) as GoogleResult[];
}
