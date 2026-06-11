// Shared Google Maps deep-link builder for a single venue/stop.
//
// Preference order:
//   1. google_place_id → query + query_place_id opens the REAL place page
//      (hours, reviews, photos) — every active catalog place carries one and
//      the detail RPCs (fix03) merge it into every stop.
//   2. lat/lng → coordinate pin (legacy E20 behavior).
//   3. name text-search.
// Genuine DIRECTIONS urls (maps/dir/?api=1) are a different intent and are NOT
// built here — see ItineraryActions.mapsRouteUrl.
export function placeMapUrl(p: {
  name: string;
  googlePlaceId?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  if (p.googlePlaceId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${p.googlePlaceId}`;
  }
  if (p.lat != null && p.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
}
