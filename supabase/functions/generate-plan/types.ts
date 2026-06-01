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
  max_radius_km: number;
  location: 'out' | 'home';
  effort: Effort;
  you_pronouns?: 'she/her' | 'he/him' | 'they/them' | '';
  partner_pronouns?: 'she/her' | 'he/him' | 'they/them' | '';
  note?: string;
  when?: 'tonight' | 'future';
  future_date?: string;
  intent?: 'impress' | 'chill' | 'reconnect' | 'try_something_new' | '';
  time_of_day?: 'morning' | 'evening' | 'all_day';
  // M1: additive + optional. Resolves which city's places + provider to use.
  // Absent ⇒ 'kelowna' (byte-identical to pre-M1 behavior).
  city_slug?: string;
}

// M1: the city a generation is scoped to. centroid_lat/lng are scalar
// (from cities.centroid via migration) because filterPlaces does JS haversine.
export interface CityRecord {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  timezone: string;
  centroid_lat: number;
  centroid_lng: number;
  default_radius_km: number;
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
  reservation_url: string | null;
  photo_url: string | null;
  lat: number | null;
  lng: number | null;
  opens: string | null;
  closes: string | null;
  quality_score: number;
  feedback_score: number;
  local_insight: string | null;
  notes: string | null;
  is_active?: boolean;
  at_home?: boolean;
  // 'low' | 'medium' | 'high' — how annoying to actually execute (parking,
  // wait times, reservations). Tonight plans bias hard toward 'low'.
  friction_score?: 'low' | 'medium' | 'high';
  // 'exceeds_price' | 'matches' | 'overpriced' — does this feel like more
  // value than what it costs? Tight budgets bias toward 'exceeds_price'.
  perceived_value?: 'exceeds_price' | 'matches' | 'overpriced';
  // AI-classified photo metadata (nullable until classify-photos has run).
  photo_time_of_day?: 'day' | 'dusk' | 'evening' | 'any' | null;
  photo_season?: 'winter' | 'spring' | 'summer' | 'fall' | 'any' | null;
  photo_has_snow?: boolean | null;
  // Taste system fields — pulled from places table for editorial packs,
  // negative-space, recency boost, and the delighter rule.
  created_at?: string;
  total_appearances?: number;
  is_delighter?: boolean;
}

// ─── Editorial Pack types ──────────────────────────────────────────────

/** Constraints a pack places on venue selection. */
export interface PackVenueConstraint {
  /** At least N stops must satisfy this predicate. */
  min_count: number;
  /** Filter function key — resolved at runtime in scoring. */
  predicate: string;
}

/** Sequence ordering rules for a pack. */
export interface PackSequenceRule {
  /** Which stop index (0-based) this rule targets. -1 = last. */
  position: number | 'last';
  /** The predicate that the stop at this position must satisfy. */
  predicate: string;
}

export interface EditorialPack {
  id: string;
  name: string;
  /** Short tagline used as a seed for LLM tone — injected into the prompt. */
  voice_note: string;
  /** Venue-level constraints that augment default scoring. */
  venue_constraints: PackVenueConstraint[];
  /** Ordering rules applied after selection. */
  sequence_rules: PackSequenceRule[];
  /** Budget range this pack targets (per person). null = any. */
  budget_range: { min: number; max: number } | null;
  /** Time-of-day affinity. null = any. */
  time_of_day: ('morning' | 'evening' | 'all_day')[] | null;
  /** Occasion affinity. null = any. */
  occasions: Occasion[] | null;
  /** Vibe tags that make this pack a strong match. */
  vibe_affinity: string[];
  /** Scoring overrides applied to candidates when this pack is active. */
  scoring_overrides: PackScoringOverride[];
}

export interface PackScoringOverride {
  /** Predicate key identifying which places this override hits. */
  predicate: string;
  /** Additive score adjustment (positive = boost, negative = penalty). */
  delta: number;
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
  place_slug?: string;
  place_type: string;
  start_time: string;
  duration_min: number;
  estimated_cost_pp: number;
  what_to_do?: string;
  drive_to_next_min?: number;
  // Inlined from places so the frontend doesn't need a second round-trip.
  // Real per-place photos override the type-based fallback in the UI.
  photo_url?: string | null;
  address?: string | null;
  neighborhood?: string;
  lat?: number | null;
  lng?: number | null;
  local_insight?: string | null;
  reservation_url?: string | null;
  reservation_required?: boolean;
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
