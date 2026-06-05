// Foursquare Places (new API) — pure mappers + a thin search/geocode fetch.
// A drop-in mirror of google-places.ts so the on-the-fly cache-warmer can swap
// one import line. The new Places API (places-api.foursquare.com) is the only
// venue source whose license permits fetch + store-forever + LLM-feed + display
// (Google Maps ToS §3.2.3 forbids the cache+LLM path we ran before).
//
// Key shape differences from Google (RESEARCH Pitfalls):
//   - hours.regular is per-day {day:1..7, open:"HHMM", close:"HHMM"} — NOT free text
//   - rating is already 0.0–10.0 — do NOT ×2
//   - photos are {prefix, suffix} fragments — assemble prefix + size + suffix
//   - auth is `Authorization: Bearer` + `X-Places-Api-Version` (NOT bare V3 key)

import {
  driveClusterFromNeighborhood,
  neighborhoodFromLatLng,
  slugify,
} from './google-places.ts';

const FSQ_HOST = 'https://places-api.foursquare.com';
const FSQ_API_VERSION = '2025-06-17';

// Inline fields so search returns hours/photos/price/rating without a Details call.
const SEARCH_FIELDS = [
  'fsq_place_id', 'name', 'latitude', 'longitude', 'location', 'categories',
  'hours', 'price', 'rating', 'popularity', 'photos', 'website', 'tel', 'date_closed',
].join(',');

export interface FsqResult {
  fsq_place_id: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  location?: {
    address?: string;
    locality?: string;
    region?: string;
    postcode?: string;
    formatted_address?: string;
  };
  categories?: { fsq_category_id?: string; name?: string }[];
  hours?: { regular?: { day: number; open: string; close: string }[]; display?: string; open_now?: boolean };
  price?: number; // 1..4
  rating?: number; // 0.0..10.0  (already 10-scale — do NOT ×2)
  popularity?: number; // 0.0..1.0
  photos?: { prefix?: string; suffix?: string; width?: number; height?: number }[];
  website?: string;
  tel?: string;
  date_closed?: string;
}

// FSQ category names (lowercased, substring match, first wins) → our place_type
// enum. Mirrors mapGoogleTypes; anything unmatched falls back to 'activity'.
export function mapFsqCategories(categories: { name?: string }[] | undefined): string {
  const names = (categories ?? []).map((c) => (c.name ?? '').toLowerCase());
  const rules: { ours: string; match: string[] }[] = [
    { ours: 'winery',       match: ['winery'] },
    { ours: 'brewery',      match: ['brewery', 'beer'] },
    { ours: 'cocktail_bar', match: ['cocktail', 'bar', 'pub', 'nightclub', 'night club'] },
    { ours: 'cafe',         match: ['coffee', 'café', 'cafe'] },
    { ours: 'bakery',       match: ['bakery'] },
    { ours: 'ice_cream',    match: ['ice cream'] },
    { ours: 'dessert',      match: ['dessert'] },
    { ours: 'restaurant',   match: ['restaurant', 'diner', 'eatery'] },
    { ours: 'gallery',      match: ['art gallery', 'gallery'] },
    { ours: 'beach',        match: ['beach'] },
    { ours: 'park',         match: ['park'] },
    { ours: 'garden',       match: ['garden'] },
    { ours: 'hike',         match: ['trail', 'hiking'] },
    { ours: 'viewpoint',    match: ['scenic', 'lookout', 'overlook'] },
    { ours: 'market',       match: ['market'] },
    { ours: 'activity',     match: ['museum', 'bowling', 'spa', 'arcade'] },
  ];
  for (const r of rules) {
    if (names.some((n) => r.match.some((m) => n.includes(m)))) return r.ours;
  }
  return 'activity';
}

// Foursquare price: 1=cheap..4=very expensive. Undefined → neutral $$.
export function priceToTier(price: number | undefined): string {
  if (price === 1) return '$';
  if (price === 2) return '$$';
  if (price === 3 || price === 4) return '$$$';
  return '$$';
}

// FSQ: hours.regular = [{ day: 1..7 (Mon..Sun), open: "1100", close: "2200" }].
// Pick Wednesday (a typical day) else the first entry; parse "HHMM" → "HH:MM".
// Malformed (non-4-digit) strings null out — never coerce to "00:00", never crash.
export function pickHours(
  hours: FsqResult['hours'],
): { opens: string | null; closes: string | null } {
  const reg = hours?.regular;
  if (!reg || reg.length === 0) return { opens: null, closes: null };
  const pick = reg.find((r) => r.day === 3) ?? reg[0];
  const fmt = (hhmm: string | undefined): string | null => {
    if (!hhmm || !/^\d{4}$/.test(hhmm)) return null;
    return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
  };
  return { opens: fmt(pick.open), closes: fmt(pick.close) };
}

// Quality floor on the 0–10 FSQ scale (≈ Google's 4.0/5). A present date_closed
// is a hard exclude regardless of rating. Missing rating fails (not admitted).
export function passesQualityFloor(r: { rating?: number; date_closed?: string }): boolean {
  return (r.rating ?? 0) >= 7.0 && !r.date_closed;
}

// Foursquare photos are {prefix, suffix} fragments — full URL = prefix+size+suffix.
export function buildFsqPhotoUrl(photo: { prefix?: string; suffix?: string }): string | null {
  if (!photo.prefix || !photo.suffix) return null;
  return `${photo.prefix}original${photo.suffix}`;
}

export interface CityForMapping { id: string; slug: string; }

// Compose a single address string from the FSQ location parts.
function composeAddress(loc: FsqResult['location']): string | null {
  if (!loc) return null;
  if (loc.formatted_address) return loc.formatted_address;
  const parts = [loc.address, loc.locality, loc.region, loc.postcode].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// Map a Foursquare search result onto a `places` row. Mirrors
// googleResultToPlaceRow key-for-key: swap google_place_id→fsq_place_id,
// source 'discovered'→'foursquare', and DROP the ×2 on rating (FSQ is 0–10).
export function fsqResultToPlaceRow(r: FsqResult, city: CityForMapping, _fsqKey: string) {
  const lat = typeof r.latitude === 'number' ? r.latitude : null;
  const lng = typeof r.longitude === 'number' ? r.longitude : null;
  // neighborhoodFromLatLng's buckets are Kelowna-only — applying them to another
  // city mislabels every venue, which then leaks into the LLM copy. For
  // non-Kelowna (on-the-fly) cities, label the neighborhood with the city slug.
  const neighborhood = city.slug === 'kelowna' ? neighborhoodFromLatLng(lat, lng) : city.slug;
  const driveCluster = city.slug === 'kelowna' ? driveClusterFromNeighborhood(neighborhood) : 'multiple';
  const type = mapFsqCategories(r.categories);
  const hours = pickHours(r.hours);
  const name = r.name ?? 'Unknown';
  const photo = r.photos?.[0];
  return {
    name,
    slug: `${slugify(name || r.fsq_place_id)}-${r.fsq_place_id.slice(-6).toLowerCase()}`,
    address: composeAddress(r.location),
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
    price_tier: priceToTier(r.price),
    typical_per_person: null as number | null,
    reservation_required: false,
    reservation_url: r.website ?? null,
    photo_url: photo ? buildFsqPhotoUrl(photo) : null,
    fsq_place_id: r.fsq_place_id,
    lat,
    lng,
    // FSQ rating is already 0–10 — NO ×2 (Pitfall 3). Neutral 7 when absent.
    quality_score: typeof r.rating === 'number' ? Math.min(10, Math.round(r.rating)) : 7,
    feedback_score: 0,
    local_insight: null as string | null,
    notes: null as string | null,
    is_active: true,
    approval_status: 'auto' as const,
    source: 'foursquare' as const,
    city_id: city.id,
    discovered_at: new Date().toISOString(),
  };
}

// ─── Search ───────────────────────────────────────────────────────────────
// One GET /places/search per category. The `fields` param pulls hours/photos/
// price/rating inline so no per-place Details call is needed. fetchImpl is
// injectable so tests assert the request shape without a live key or network.
export async function searchPlaces(opts: {
  apiKey: string; lat: number; lng: number; radiusKm: number;
  categoryIds: string; limit?: number;
}, fetchImpl: typeof fetch = fetch): Promise<FsqResult[]> {
  const url = new URL(`${FSQ_HOST}/places/search`);
  url.searchParams.set('ll', `${opts.lat},${opts.lng}`);
  url.searchParams.set('radius', String(Math.round(opts.radiusKm * 1000)));
  url.searchParams.set('fsq_category_ids', opts.categoryIds);
  url.searchParams.set('fields', SEARCH_FIELDS);
  url.searchParams.set('sort', 'POPULARITY');
  url.searchParams.set('limit', String(opts.limit ?? 50));
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${opts.apiKey}`,
      'X-Places-Api-Version': FSQ_API_VERSION,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Foursquare search ${res.status}: ${await res.text()}`);
  return ((await res.json()).results ?? []) as FsqResult[];
}

// ─── Geocoding (open-city) ──────────────────────────────────────────────
// Turn a free-text city query into a center + radius using the same search
// endpoint + key. Bias to the `near` param, read the top result's coords.

export interface GeocodedCity {
  lat: number;
  lng: number;
  radiusKm: number;
  /** Display name echoed back (best-effort from the top result). */
  name: string;
}

// Geocode one free-text city query. Returns null when the query yields no
// usable result (caller surfaces a clean error). radiusKm defaults to 25.
export async function geocodeCity(
  query: string,
  opts: { apiKey: string; radiusKm?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodedCity | null> {
  const url = new URL(`${FSQ_HOST}/places/search`);
  url.searchParams.set('near', query);
  url.searchParams.set('fields', 'fsq_place_id,name,latitude,longitude,location');
  url.searchParams.set('limit', '1');
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${opts.apiKey}`,
      'X-Places-Api-Version': FSQ_API_VERSION,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Foursquare geocode ${res.status}: ${await res.text()}`);
  const top = ((await res.json()).results ?? [])[0] as FsqResult | undefined;
  const lat = top?.latitude;
  const lng = top?.longitude;
  if (top == null || typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    lat,
    lng,
    radiusKm: opts.radiusKm ?? 25,
    name: top.location?.formatted_address ?? top.name ?? query,
  };
}
