// After5 — input/output Zod schemas
//
// Used by both the web app (form validation) and Edge Functions (request
// validation). Single source of truth — schemas drift = bugs.

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Plan generation request
// ─────────────────────────────────────────────────────────────────────

export const OccasionSchema = z.enum(['date', 'solo', 'friends']);
export const EffortSchema = z.enum(['low', 'moderate', 'high']);
export const PriceTierSchema = z.enum(['$', '$$', '$$$']);

export const VibeSchema = z.enum([
  'romantic', 'chill', 'adventurous', 'boujee', 'cozy', 'spontaneous',
  'lively', 'intimate', 'casual', 'cultural', 'fun',
]);

export const MustIncludeSchema = z.enum([
  'food', 'drinks', 'walk', 'view', 'activity', 'dessert',
  'hidden_gem', 'lake', 'outdoors', 'indoors',
]);

export const GeneratePlanRequestSchema = z.object({
  occasion: OccasionSchema.default('date'),
  duration_min: z.number().int().min(60).max(720).default(180),
  budget_per_person: z.number().nonnegative().max(1000).default(50),
  vibe: z.array(VibeSchema).min(1).max(3),
  must_includes: z.array(MustIncludeSchema).max(8).default([]),
  drive_tolerance_min: z.number().int().min(0).max(120).default(20),
  effort: EffortSchema.default('low'),
  start_at: z.string().datetime().optional(),
});

export type GeneratePlanRequest = z.infer<typeof GeneratePlanRequestSchema>;

// ─────────────────────────────────────────────────────────────────────
// Plan generation response
// ─────────────────────────────────────────────────────────────────────

export const ItineraryStopSchema = z.object({
  place_id: z.string().uuid(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_min: z.number().int().positive(),
  estimated_cost_pp: z.number().nonnegative(),
  what_to_do: z.string().optional(),
  drive_to_next_min: z.number().int().nonnegative().optional(),
});

export const ItinerarySchema = z.object({
  id: z.string().uuid(),
  template_id: z.string(),
  title: z.string().min(1).max(80),
  hook: z.string().min(1).max(140),
  why_it_works: z.string().min(1).max(500),
  stops: z.array(ItineraryStopSchema).min(1).max(8),
  total_cost_pp: z.number().nonnegative(),
  total_duration_min: z.number().int().positive(),
  vibe: z.array(VibeSchema),
});

export const GeneratePlanResponseSchema = z.object({
  itineraries: z.array(ItinerarySchema).length(3),
  generated_at: z.string().datetime(),
});

export type GeneratePlanResponse = z.infer<typeof GeneratePlanResponseSchema>;

// ─────────────────────────────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────────────────────────────

export const FeedbackRequestSchema = z.object({
  itinerary_id: z.string().uuid(),
  loved_place_id: z.string().uuid().nullable(),
  skipped_place_id: z.string().uuid().nullable(),
  pacing_rating: z.enum(['rushed', 'perfect', 'slow']),
  free_text: z.string().max(1000).optional(),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
