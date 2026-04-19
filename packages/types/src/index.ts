// After5 — shared types
//
// `database.ts` is auto-generated from the Supabase schema:
//   pnpm db:types
// Don't edit it by hand.
//
// This file re-exports the generated types and adds domain-level aliases
// that both the web app and the mobile app consume.

// Auto-generated from Supabase schema. Regenerate with: pnpm db:types
export type { Database, Json } from './database';
export type { Database as DB } from './database';

// Domain types (hand-written, stable across schema changes)
export type Occasion = 'date' | 'solo' | 'friends';
export type PriceTier = '$' | '$$' | '$$$';
export type Effort = 'low' | 'moderate' | 'high';
export type Energy = 'low' | 'medium' | 'high';

export type PlaceType =
  | 'restaurant' | 'cafe' | 'winery' | 'brewery' | 'cocktail_bar'
  | 'dessert' | 'ice_cream' | 'bakery' | 'hike' | 'viewpoint' | 'beach'
  | 'park' | 'garden' | 'activity' | 'gallery' | 'market' | 'shop'
  | 'sunset_spot' | 'walk';

export type DriveCluster =
  | 'downtown' | 'pandosy' | 'lower_mission' | 'lakeshore'
  | 'glenmore' | 'rutland' | 'north_glenmore' | 'south_east_kelowna'
  | 'west_kelowna' | 'lake_country' | 'peachland' | 'summerland'
  | 'naramata' | 'oyama' | 'multiple';

export interface PlanInputs {
  occasion: Occasion;
  duration_min: number;
  budget_per_person: number;
  vibe: string[];
  must_includes: string[];
  drive_tolerance_min: number;
  effort: Effort;
}

export interface ItineraryStop {
  place_id: string;
  start_time: string;       // "HH:mm"
  duration_min: number;
  estimated_cost_pp: number;
  what_to_do?: string;      // LLM-written suggestion
  drive_to_next_min?: number;
}

export interface Itinerary {
  id: string;
  template_id: string;
  title: string;
  hook: string;
  why_it_works: string;
  stops: ItineraryStop[];
  total_cost_pp: number;
  total_duration_min: number;
  vibe: string[];
}
