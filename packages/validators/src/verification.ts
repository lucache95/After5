import { z } from 'zod';

export const VerificationKindSchema = z.enum(['phone', 'selfie', 'age']);
export type VerificationKind = z.infer<typeof VerificationKindSchema>;

// Mirrors the DB verification_state enum AFTER P1 Task 2 adds 'appeal'.
export const VerificationStateSchema = z.enum(['unverified', 'pending', 'verified', 'failed', 'appeal']);
export type VerificationState = z.infer<typeof VerificationStateSchema>;

// Persona webhook envelope (subset we depend on). reference-id carries our
// profiles.id so the webhook can map the Inquiry back to the user.
export const PersonaWebhookEventSchema = z.object({
  data: z.object({
    type: z.literal('event'),
    attributes: z.object({
      name: z.string(), // e.g. 'inquiry.approved' | 'inquiry.declined' | 'inquiry.marked-for-review'
      payload: z.object({
        data: z.object({
          id: z.string(), // inquiry id → provider_ref
          attributes: z.object({
            'reference-id': z.string().uuid().nullable().optional(),
          }),
        }),
      }),
    }),
  }),
});
export type PersonaWebhookEvent = z.infer<typeof PersonaWebhookEventSchema>;
