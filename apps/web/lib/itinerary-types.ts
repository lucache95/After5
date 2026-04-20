// Single source of truth for itinerary shape used by both the in-flow results
// view and the public detail page. Mirrors the Edge Function's ItineraryStop +
// Itinerary, plus optional fields the public page may not have computed.

export interface Stop {
  place_id: string;
  place_name: string;
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
}

export interface Itinerary {
  id?: string;
  template_id: string;
  template_name: string;
  title: string;
  hook: string;
  why_it_works: string;
  stops: Stop[];
  total_cost_pp: number;
  total_duration_min: number;
  vibe: string[];
}
