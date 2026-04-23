// Maps a place's `type` enum to a generic mood image we ship with the site.
// Per-place real photos can override via places.photo_url; this is the fallback
// so EVERY stop has a hero image even before we curate per-place photography.

const TYPE_TO_IMAGE: Record<string, string> = {
  restaurant:   '/places/place-restaurant.jpg',
  cafe:         '/places/place-cafe.jpg',
  winery:       '/places/place-winery.jpg',
  brewery:      '/places/place-brewery.jpg',
  cocktail_bar: '/places/place-cocktail-bar.jpg',
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
};

const FALLBACK = '/places/place-walk.jpg';

export function imageForStop(opts: {
  photo_url?: string | null;
  place_type?: string | null;
}): string {
  if (opts.photo_url) return opts.photo_url;
  if (opts.place_type && TYPE_TO_IMAGE[opts.place_type]) {
    return TYPE_TO_IMAGE[opts.place_type];
  }
  return FALLBACK;
}

// Pick the most distinctive image for an itinerary cover card. Prefers a stop
// with a real Google photo; only falls back to a type-based mood shot if none
// of the stops has one. Avoids two plans showing the same generic forest/hike
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

  const pool = opts.excludePlaceId
    ? stops.filter((s) => s.place_id !== opts.excludePlaceId)
    : stops;
  const withPhoto = pool.find((s) => s.photo_url);
  if (withPhoto) return withPhoto.photo_url!;
  // No photo on the non-excluded stops? Try the type fallback of the first
  // non-excluded stop; if all stops were the excluded one, fall back to first.
  return imageForStop(pool[0] ?? stops[0] ?? {});
}
