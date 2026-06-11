// Single source of truth for itinerary shape used by both the in-flow results
// view and the public detail page. Mirrors the Edge Function's ItineraryStop +
// Itinerary, plus optional fields the public page may not have computed.

export interface Stop {
  place_id: string;
  place_name: string;
  /** Google place id for the venue (when the stop came from the catalog) —
   *  map links prefer it so they open the real place page. */
  google_place_id?: string | null;
  place_slug?: string;
  place_type?: string;
  start_time: string;
  duration_min: number;
  estimated_cost_pp: number;
  what_to_do?: string;
  drive_to_next_min?: number;
  photo_url?: string | null;
  address?: string | null;
  neighborhood?: string;
  lat?: number | null;
  lng?: number | null;
  local_insight?: string | null;
  reservation_url?: string | null;
  reservation_required?: boolean;
}

export interface Modifier {
  id: string;
  label: string;
  body: string;
  difficulty: 'tame' | 'spicy' | 'chaos';
}

export interface Itinerary {
  id?: string;
  slug?: string;
  modifier?: Modifier | null;
  template_id: string;
  template_name: string;
  title: string;
  hook: string;
  why_it_works: string;
  stops: Stop[];
  total_cost_pp: number;
  total_duration_min: number;
  vibe: string[];
  cover_image_url?: string | null;
}
