// Locale-aware distance formatting for the blind dating feed.
//
// Distances arrive from the feed RPC in metres (`distance_m`); reach radii arrive
// in kilometres (planned `search_radius_km`, spec §1). Viewers in the US / UK /
// Liberia / Myanmar read miles; everyone else reads km. We pick the unit from the
// viewer's resolved locale region so the card matches their intuition without a
// settings toggle.
//
// BLIND-SAFE: these are coarse, rounded values (0.1 km / whole km / whole mi).
// They never expose a precise venue position — just "how far, roughly".

const MILES_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

const KM_PER_MILE = 1.609344;

/** Does the viewer's locale read in miles? Falls back to km when unknown. */
export function prefersMiles(locale?: string): boolean {
  // Server render and pre-mount: no locale → default to km (the global majority).
  const tag = locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined);
  if (!tag) return false;
  // Region subtag, e.g. "en-US" → "US". Intl.Locale gives the canonical region.
  try {
    const region = new Intl.Locale(tag).maximize().region;
    return region ? MILES_REGIONS.has(region) : false;
  } catch {
    return false;
  }
}

/** "0.4 mi away" / "12 km away". null distance → null (caller omits the row). */
export function formatDistanceAway(distanceM: number | null, locale?: string): string | null {
  if (distanceM == null) return null;
  const km = distanceM / 1000;
  if (prefersMiles(locale)) {
    const mi = km / KM_PER_MILE;
    const v = mi < 1 ? Math.max(0.1, Math.round(mi * 10) / 10) : Math.round(mi);
    return `${v} mi away`;
  }
  const v = km < 1 ? Math.max(0.1, Math.round(km * 10) / 10) : Math.round(km);
  return `${v} km away`;
}

/** "30 km" / "19 mi" — a reach radius (already in km). null → null. */
export function formatReach(radiusKm: number | null | undefined, locale?: string): string | null {
  if (radiusKm == null) return null;
  if (prefersMiles(locale)) {
    return `${Math.round(radiusKm / KM_PER_MILE)} mi`;
  }
  return `${Math.round(radiusKm)} km`;
}
