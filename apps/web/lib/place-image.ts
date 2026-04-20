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
