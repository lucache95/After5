// Resolve a Vercel geo city header (x-vercel-ip-city) to a known generatable city slug.
// Falls back to kelowna (the only generatable city pre-#67). fellBack drives the
// "we're only in kelowna right now" note in the UI.
export interface KnownCity { slug: string; name: string }

export function resolveCitySlug(
  geoCity: string | null | undefined,
  known: KnownCity[],
): { slug: string; fellBack: boolean } {
  const FALLBACK = 'kelowna';
  if (!geoCity) return { slug: FALLBACK, fellBack: true };
  const decoded = decodeURIComponent(geoCity).trim().toLowerCase();
  const hit = known.find((c) => c.name.toLowerCase() === decoded || c.slug === decoded);
  return hit ? { slug: hit.slug, fellBack: false } : { slug: FALLBACK, fellBack: true };
}
