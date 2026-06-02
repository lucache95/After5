// Server-enforced blur-gate for the date-first landing. An anon visitor sees the
// hero + the first stop; everything premium (the rationale, later-stop identity,
// map coords, local insights) is STRIPPED here so it never reaches the anon DOM.
// Locked decision (2026-06-01): hero + stop 1 visible, stops 2..N silhouetted, why/map/insights locked.
import type { Itinerary, ItineraryStop } from '../../../../supabase/functions/generate-plan/types';

export interface GatedStop extends Partial<ItineraryStop> {
  place_id: string;
  place_type: string;
  photo_url?: string | null;
  locked?: boolean;
}
export interface GatedItinerary extends Omit<Itinerary, 'stops'> {
  stops: GatedStop[];
  locked: boolean;
}

export function toTeaser(itineraries: Itinerary[], opts: { authed: boolean }): GatedItinerary[] {
  if (opts.authed) {
    return itineraries.map((it) => ({ ...it, stops: it.stops.map((s) => ({ ...s })), locked: false }));
  }
  return itineraries.map((it) => ({
    ...it,
    why_it_works: '', // locked — the premium rationale
    locked: true,
    stops: it.stops.map((s, i) =>
      i === 0
        ? { ...s, locked: false }
        : {
            // silhouette: only the shape (type + blurred photo) survives
            place_id: s.place_id,
            place_type: s.place_type,
            photo_url: s.photo_url ?? null,
            place_name: '',
            address: null,
            neighborhood: undefined,
            lat: null,
            lng: null,
            local_insight: null,
            reservation_url: null,
            locked: true,
          },
    ),
  }));
}
