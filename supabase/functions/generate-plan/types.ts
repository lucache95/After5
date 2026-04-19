// Local Deno-compatible type definitions for the generate-plan function.
// Mirror what's in packages/types but redefined here so the Edge Function
// has zero workspace dependencies (Deno doesn't resolve workspace:*).

export type Occasion = 'date' | 'solo' | 'friends';
export type Effort = 'low' | 'moderate' | 'high';
export type PriceTier = '$' | '$$' | '$$$';

export interface PlanInputs {
  occasion: Occasion;
  duration_min: number;
  budget_per_person: number;
  vibe: string[];
  must_includes: string[];
  drive_tolerance_min: number;
  effort: Effort;
}

export interface Place {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  neighborhood: string;
  drive_cluster: string;
  type: string;
  vibe_tags: string[];
  pairing_tags: string[];
  effort: string;
  time_of_day: string[];
  weather_dependent: boolean;
  seasonality: string[];
  typical_duration_min: number;
  price_tier: string;
  typical_per_person: number | null;
  reservation_required: boolean;
  quality_score: number;
  feedback_score: number;
  local_insight: string | null;
  notes: string | null;
}

export interface TemplateSlot {
  types: string[];
  duration_min: number;
  time_of_day?: string[];
  effort?: string[];
  price_tier?: string[];
  prefers_pairing_tags?: string[];
  reservation_required?: boolean;
}

export interface Template {
  id: string;
  name: string;
  duration_min: number;
  suitable_for: string[];
  vibe: string[];
  slots: TemplateSlot[];
  geographic_rule: string | null;
  energy_curve: string | null;
}

export interface ItineraryStop {
  place_id: string;
  place_name: string;
  start_time: string;
  duration_min: number;
  estimated_cost_pp: number;
  what_to_do?: string;
  drive_to_next_min?: number;
}

export interface Itinerary {
  template_id: string;
  template_name: string;
  title: string;
  hook: string;
  why_it_works: string;
  stops: ItineraryStop[];
  total_cost_pp: number;
  total_duration_min: number;
  vibe: string[];
}

export interface GeneratePlanResponse {
  itineraries: Itinerary[];
  generated_at: string;
}
