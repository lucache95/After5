// packages/validators/src/__tests__/profile.test.ts
import { describe, it, expect } from 'vitest';
import {
  PreferencesInputSchema,
  ProfileInputSchema,
  PromptAnswerSchema,
  PersonaWebhookEventSchema,
  GenderSchema,
  MAX_BIO,
  PROMPT_IDS,
  PronounsSchema,
  ExpandedProfileSchema,
  PhotoMetaSchema,
  MAX_PHOTOS,
} from '../index';

describe('PreferencesInputSchema', () => {
  it('accepts a valid preferences payload', () => {
    const parsed = PreferencesInputSchema.parse({
      gender: 'woman',
      gender_preferences: ['man', 'nonbinary'],
      age_min: 25,
      age_max: 40,
      distance_pref_km: 35,
      dealbreakers: ['smoking'],
    });
    expect(parsed.age_min).toBe(25);
  });
  it('rejects age_min below 18 (age gate at the type boundary)', () => {
    expect(() =>
      PreferencesInputSchema.parse({
        gender: 'woman', gender_preferences: ['man'],
        age_min: 17, age_max: 30, distance_pref_km: 20, dealbreakers: [],
      }),
    ).toThrow();
  });
  it('rejects age_max < age_min', () => {
    expect(() =>
      PreferencesInputSchema.parse({
        gender: 'man', gender_preferences: ['woman'],
        age_min: 40, age_max: 30, distance_pref_km: 20, dealbreakers: [],
      }),
    ).toThrow();
  });
});

describe('ProfileInputSchema', () => {
  it('caps bio length and prompt count', () => {
    // 500 is now comfortably under the cap (raised to MAX_BIO); over-cap still rejects.
    expect(() => ProfileInputSchema.parse({ first_name: 'Lee', bio: 'x'.repeat(500), prompts: [] })).not.toThrow();
    expect(() => ProfileInputSchema.parse({ first_name: 'Lee', bio: 'x'.repeat(MAX_BIO + 1), prompts: [] })).toThrow();
    const tooMany = Array.from({ length: 4 }, () => ({ prompt_id: 'two_truths', answer: 'a' }));
    expect(() => ProfileInputSchema.parse({ first_name: 'Lee', bio: 'hi', prompts: tooMany })).toThrow();
  });
});

describe('PromptAnswerSchema', () => {
  it('requires a known prompt id', () => {
    expect(() => PromptAnswerSchema.parse({ prompt_id: 'not_a_prompt', answer: 'a' })).toThrow();
  });
});

describe('PersonaWebhookEventSchema', () => {
  it('parses an inquiry.approved event', () => {
    const ev = PersonaWebhookEventSchema.parse({
      data: {
        type: 'event',
        attributes: {
          name: 'inquiry.approved',
          payload: { data: { id: 'inq_123', attributes: { 'reference-id': '00000000-0000-0000-0000-000000000001' } } },
        },
      },
    });
    expect(ev.data.attributes.name).toBe('inquiry.approved');
  });
});

describe('GenderSchema', () => {
  it('enumerates the allowed identities', () => {
    expect(() => GenderSchema.parse('woman')).not.toThrow();
    expect(() => GenderSchema.parse('alien')).toThrow();
  });
});

describe('M6 expanded profile', () => {
  it('accepts up to 3 prompt answers and rejects 4', () => {
    const a = { prompt_id: PROMPT_IDS[0], answer: 'hi' };
    expect(ProfileInputSchema.safeParse({ first_name: 'a', prompts: [a, a, a] }).success).toBe(true);
    expect(ProfileInputSchema.safeParse({ first_name: 'a', prompts: [a, a, a, a] }).success).toBe(false);
  });
  it('validates pronouns and optional expanded fields', () => {
    expect(PronounsSchema.safeParse('she/her').success).toBe(true);
    const ok = ExpandedProfileSchema.safeParse({ height_cm: 170, occupation: 'barista', socials: { spotify: 'x' } });
    expect(ok.success).toBe(true);
    expect(ExpandedProfileSchema.safeParse({ height_cm: 400 }).success).toBe(false);
  });
  it('caps the gallery at MAX_PHOTOS and validates a photo row', () => {
    expect(MAX_PHOTOS).toBe(6);
    const p = PhotoMetaSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111', sort_order: 0, is_primary: true });
    expect(p.success).toBe(true);
  });
});
