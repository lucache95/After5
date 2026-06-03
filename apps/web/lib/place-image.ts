// Resolves a tasteful, on-theme image for every stop and date cover. Real
// per-place photos (Google Places `photo_url` / AI `generated_photo_url`) and
// curated itinerary covers (`cover_image_url`) win when present; otherwise we
// ALWAYS fall back to a shipped local asset keyed by place_type and/or vibe so
// no surface ever renders an empty pink placeholder (bug #77).
//
// All fallbacks point at images that exist under apps/web/public:
//   /places/*  — per-type mood shots (restaurant, cafe, hike, …)
//   /vibes/*   — vibe mood shots (romantic, chill, adventurous, …)
//   /pins/*    — couple lifestyle shots (used to vary date covers)

const TYPE_TO_IMAGE: Record<string, string> = {
  restaurant:   '/places/place-restaurant.jpg',
  cafe:         '/places/place-cafe.jpg',
  winery:       '/places/place-winery.jpg',
  brewery:      '/places/place-brewery.jpg',
  cocktail_bar: '/places/place-cocktail-bar.jpg',
  bar:          '/places/place-cocktail-bar.jpg',
  dessert:      '/places/place-dessert.jpg',
  ice_cream:    '/places/place-ice-cream.jpg',
  bakery:       '/places/place-bakery.jpg',
  hike:         '/places/place-hike.jpg',
  viewpoint:    '/places/place-viewpoint.jpg',
  sunset_spot:  '/places/place-viewpoint.jpg',
  beach:        '/places/place-beach.jpg',
  park:         '/places/place-beach.jpg',
  garden:       '/places/place-walk.jpg',
  walk:         '/places/place-walk.jpg',
  activity:     '/places/place-activity.jpg',
  gallery:      '/places/place-activity.jpg',
  market:       '/places/place-activity.jpg',
  shop:         '/places/place-activity.jpg',
  // Coarse buckets the brief calls out that aren't part of the place_type enum
  // but can arrive on thin/legacy stops:
  food:         '/places/place-restaurant.jpg',
  drinks:       '/places/place-cocktail-bar.jpg',
  outdoor:      '/places/place-beach.jpg',
};

// Vibe (or any vibe_tag substring) → best-matching shipped mood shot. Mirrors
// the vibe vocabulary used elsewhere (romantic, chill, adventurous, foodie,
// boozy, creative, cozy, boujee, …). Matched case-insensitively by substring so
// "super romantic" and "Adventurous" both resolve.
const VIBE_TO_IMAGE: Array<{ keywords: string[]; image: string }> = [
  { keywords: ['romantic', 'intimate', 'date night'], image: '/vibes/vibe-romantic.jpg' },
  { keywords: ['adventurous', 'adventure', 'active', 'hike', 'wild', 'spontaneous'], image: '/vibes/vibe-adventurous.jpg' },
  { keywords: ['boujee', 'bougie', 'luxe', 'fancy', 'splurge', 'classy'], image: '/vibes/vibe-boujee.jpg' },
  { keywords: ['cozy', 'cosy', 'homey', 'snug', 'warm'], image: '/vibes/vibe-cozy.jpg' },
  { keywords: ['chill', 'relaxed', 'laid', 'easy', 'mellow'], image: '/vibes/vibe-chill.jpg' },
  { keywords: ['free', 'outdoor', 'nature', 'lively'], image: '/vibes/vibe-free.jpg' },
];

// Couple lifestyle shots used purely to add variety across date covers when we
// have nothing better than a vibe/type fallback (so two adjacent generated
// dates don't show the identical mood shot).
const COVER_VARIANTS = [
  '/pins/couple-field.jpg',
  '/pins/couple-lake-kiss.jpg',
  '/pins/couple-trail.jpg',
  '/pins/couple-wakeboard.jpg',
] as const;

const FALLBACK = '/places/place-walk.jpg';

// Stable, cheap string hash (djb2) → non-negative int, for deterministic
// per-stop / per-date image variation. Same input always picks the same image.
function hashString(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) + hash + seed.charCodeAt(i);
    hash |= 0; // keep 32-bit
  }
  return Math.abs(hash);
}

function imageForVibes(vibeTags?: string[] | null): string | null {
  if (!vibeTags || vibeTags.length === 0) return null;
  for (const tag of vibeTags) {
    if (!tag) continue;
    const lower = tag.toLowerCase();
    for (const { keywords, image } of VIBE_TO_IMAGE) {
      if (keywords.some((kw) => lower.includes(kw))) return image;
    }
  }
  return null;
}

export function imageForStop(opts: {
  photo_url?: string | null;
  generated_photo_url?: string | null;
  place_type?: string | null;
  vibe_tags?: string[] | null;
  /** Optional stable key (e.g. stop name) to vary the vibe fallback per stop. */
  seedKey?: string | null;
}): string {
  // 1. Real Google Places photo — highest fidelity.
  if (opts.photo_url) return opts.photo_url;
  // 2. AI-generated place cover (Gemini) — venue-specific visual.
  if (opts.generated_photo_url) return opts.generated_photo_url;
  // 3. Type-based generic fallback (/places/place-restaurant.jpg, etc.).
  if (opts.place_type && TYPE_TO_IMAGE[opts.place_type]) {
    return TYPE_TO_IMAGE[opts.place_type];
  }
  // 4. Vibe-based mood shot when the stop has no usable type.
  const vibeImage = imageForVibes(opts.vibe_tags);
  if (vibeImage) return vibeImage;
  return FALLBACK;
}

// Pick the most distinctive image for an itinerary cover card. Prefers a stop
// with a real Google photo; only falls back to a type/vibe mood shot if none of
// the stops has one. Avoids two plans showing the same generic forest/hike
// image just because their first stops happen to share a type.
//
// When rendering the "dates featuring this place" grid on /places/[slug], pass
// `excludePlaceId` so the cover doesn't repeat the place we're already on.
export function coverImageFor(
  stops: Array<{
    place_id?: string;
    photo_url?: string | null;
    place_type?: string | null;
  }>,
  opts: { excludePlaceId?: string; itineraryCover?: string | null } = {},
): string {
  // Prefer the AI-generated, branded cover when present — beats borrowing
  // a stop photo (which can dup across plans + show snow in spring).
  if (opts.itineraryCover) return opts.itineraryCover;

  // Guard: if stops array is empty/undefined, return a guaranteed-valid
  // local asset so callers never receive an unusable value.
  if (!stops || stops.length === 0) return FALLBACK;

  const pool = opts.excludePlaceId
    ? stops.filter((s) => s.place_id !== opts.excludePlaceId)
    : stops;
  const withPhoto = pool.find((s) => s.photo_url);
  if (withPhoto) return withPhoto.photo_url!;
  // No photo on the non-excluded stops? Try the type fallback of the first
  // non-excluded stop; if all stops were the excluded one, fall back to first.
  return imageForStop(pool[0] ?? stops[0] ?? {});
}

// Cover resolver for the blind DATING feed (NightCard / NightDetailSheet). The
// feed projection only exposes cover_image_url + vibe_tags (+ optional stops in
// the detail RPC), never a venue identity. This guarantees a tasteful cover:
//   1. the itinerary's own curated cover, if any
//   2. a real stop photo, if the detail RPC handed us stops with one
//   3. a vibe mood shot keyed off vibe_tags
//   4. a deterministic couple-lifestyle variant (so adjacent dates differ)
//   5. the type fallback of the first stop, then the global fallback
// It NEVER returns '' so next/image can't throw.
export function coverImageForNight(opts: {
  cover_image_url?: string | null;
  vibe_tags?: string[] | null;
  stops?: Array<{ photo_url?: string | null; place_type?: string | null }> | null;
  /** Stable key (date_instance_id or title) to vary the lifestyle fallback. */
  seedKey?: string | null;
}): string {
  if (opts.cover_image_url) return opts.cover_image_url;

  const stops = opts.stops ?? [];
  const withPhoto = stops.find((s) => s.photo_url);
  if (withPhoto?.photo_url) return withPhoto.photo_url;

  const vibeImage = imageForVibes(opts.vibe_tags);
  if (vibeImage) return vibeImage;

  // No vibe match and no photo — vary a couple-lifestyle cover deterministically
  // so a screen full of generated dates doesn't show one repeated image.
  const seed = opts.seedKey ?? stops.map((s) => s.place_type ?? '').join('|');
  if (seed) {
    return COVER_VARIANTS[hashString(seed) % COVER_VARIANTS.length];
  }

  // Last resort: type fallback off the first stop, then the global fallback.
  return imageForStop(stops[0] ?? {});
}
