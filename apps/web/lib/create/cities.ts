// Curated cities power the /create quick-pick suggestions. The city field is
// now free text (open-city): the typed string is geocoded edge-side, so any
// input works — these are just one-tap shortcuts, not a closed list.
export interface KnownCity { slug: string; name: string }

// Seed the city input from the Vercel geo header when we have one, else leave
// it blank so the placeholder invites the user to type. No "we're only in X"
// fallback — every city generates now.
export function initialCityText(geoCity: string | null | undefined): string {
  if (!geoCity) return '';
  const decoded = decodeURIComponent(geoCity).trim();
  return decoded;
}
