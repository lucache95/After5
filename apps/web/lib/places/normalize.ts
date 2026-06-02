// M3.5 — pure mappers: a Google Places (New) Text Search result → an inline editor
// `Stop`, and → a `custom_venue_submissions` insert row (the admin promotion queue).
//
// These never touch the curated `places` table: the inline stop carries a
// `custom:<googleId>` place_id and the pick is only recorded to the queue for later
// admin curation.
//
// PHOTO NOTE (v1): we deliberately set `photo_url = null` on a custom stop. Building a
// usable Google photo URL requires embedding GOOGLE_PLACES_API_KEY in the URL, which
// would leak it to the client. Instead we record the full raw result (incl.
// `photos[].name`) on the submission row so a server-side job can fetch the photo at
// promotion time. The editor shows a type fallback meanwhile.
import type { Stop } from '@/lib/itinerary-types';

export interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  photos?: { name: string }[];
}

// Small subset of the M1 mapGoogleTypes rules — enough for the inline custom stop.
// First match wins; anything unmatched falls back to 'activity'.
export function mapType(googleTypes: string[] | undefined): string {
  const set = new Set(googleTypes ?? []);
  const rules: { ours: string; match: string[] }[] = [
    { ours: 'cafe', match: ['cafe', 'coffee_shop'] },
    { ours: 'bar', match: ['bar', 'night_club'] },
    { ours: 'restaurant', match: ['restaurant', 'meal_takeaway', 'meal_delivery', 'food'] },
    { ours: 'park', match: ['park', 'national_park', 'botanical_garden'] },
  ];
  for (const r of rules) {
    if (r.match.some((t) => set.has(t))) return r.ours;
  }
  return 'activity';
}

export function googlePlaceToStop(r: GooglePlace): Stop {
  return {
    place_id: `custom:${r.id}`,
    place_name: r.displayName?.text ?? '',
    place_type: mapType(r.types),
    address: r.formattedAddress ?? null,
    lat: r.location?.latitude ?? null,
    lng: r.location?.longitude ?? null,
    photo_url: null, // see PHOTO NOTE above — never embed the API key client-side.
    start_time: '19:00',
    duration_min: 60,
    estimated_cost_pp: 0,
  };
}

export interface CustomVenueSubmissionRow {
  itinerary_id: string | null;
  google_place_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  raw: GooglePlace;
}

export function googlePlaceToSubmission(
  r: GooglePlace,
  itineraryId: string | null,
): CustomVenueSubmissionRow {
  return {
    itinerary_id: itineraryId,
    google_place_id: r.id,
    name: r.displayName?.text ?? '',
    lat: r.location?.latitude ?? null,
    lng: r.location?.longitude ?? null,
    raw: r,
  };
}
