import { z } from 'zod';
export const PostNightInput = z.object({
  itinerary_id: z.string().uuid(),
  starts_at: z.string().datetime(),
  venue_id: z.string().uuid().nullable().optional(),
  duration_min: z.number().int().min(30).max(600).default(150),
});
export type PostNightInput = z.infer<typeof PostNightInput>;
