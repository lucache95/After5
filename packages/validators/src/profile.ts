import { z } from 'zod';

// Orientation vocab — kept small and stable; the DB stores plain text[] so
// new values are additive without a migration. Mirrors spec §5 pre-filter inputs.
export const GenderSchema = z.enum(['woman', 'man', 'nonbinary']);
export type Gender = z.infer<typeof GenderSchema>;

// 18+ is enforced at the type boundary AND in the DB (Task 3). Belt and braces.
export const MIN_AGE = 18;
export const MAX_AGE = 99;

// Known dealbreaker tags. text[] in the DB; this enum keeps the UI/contract honest.
export const DealbreakerSchema = z.enum([
  'smoking', 'wants_kids', 'no_kids', 'drinks_alcohol', 'no_alcohol', 'has_pets', 'no_pets',
]);

export const PreferencesInputSchema = z
  .object({
    gender: GenderSchema,
    gender_preferences: z.array(GenderSchema).min(1).max(3),
    age_min: z.number().int().min(MIN_AGE).max(MAX_AGE),
    age_max: z.number().int().min(MIN_AGE).max(MAX_AGE),
    distance_pref_km: z.number().int().min(1).max(150),
    dealbreakers: z.array(DealbreakerSchema).max(8).default([]),
  })
  .refine((p) => p.age_max >= p.age_min, {
    message: 'age_max must be >= age_min',
    path: ['age_max'],
  });
export type PreferencesInput = z.infer<typeof PreferencesInputSchema>;

// The set of profile prompts a creator can answer. Stable ids → DB rows (Task 2).
export const PROMPT_IDS = [
  'two_truths', 'my_ideal_first_date', 'unusual_skill', 'best_kelowna_spot', 'a_perfect_sunday',
] as const;
export const PromptIdSchema = z.enum(PROMPT_IDS);

export const PromptAnswerSchema = z.object({
  prompt_id: PromptIdSchema,
  answer: z.string().min(1).max(200),
});
export type PromptAnswer = z.infer<typeof PromptAnswerSchema>;

export const ProfileInputSchema = z.object({
  first_name: z.string().min(1).max(40),
  bio: z.string().max(500).default(''),
  vibe_tags: z.array(z.string().max(24)).max(8).default([]),
  prompts: z.array(PromptAnswerSchema).max(3).default([]),
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

// Onboarding is a linear set of steps; the server stores the furthest completed.
export const OnboardingStepSchema = z.enum([
  'age_gate', 'basics', 'photos', 'preferences', 'phone_verify', 'selfie_verify', 'done',
]);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
