// Curated cities power the /create quick-pick suggestions. The city field is
// now free text (open-city): the typed string is geocoded edge-side, so any
// input works — these are just one-tap shortcuts, not a closed list.
//
// `id` is the cities.id uuid. A curated pick by a signed-in user resolves to this
// id so the funnel can write profiles.primary_city_id + warm the city (Phase 10).
export interface KnownCity { id: string; slug: string; name: string }

// Seed the city input from the Vercel geo header when we have one, else leave
// it blank so the placeholder invites the user to type. No "we're only in X"
// fallback — every city generates now.
export function initialCityText(geoCity: string | null | undefined): string {
  if (!geoCity) return '';
  const decoded = decodeURIComponent(geoCity).trim();
  return decoded;
}
