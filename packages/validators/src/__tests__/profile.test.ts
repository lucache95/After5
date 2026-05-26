// packages/validators/src/__tests__/profile.test.ts
import { describe, it, expect } from 'vitest';
import {
  PreferencesInputSchema,
  ProfileInputSchema,
  PromptAnswerSchema,
  PersonaWebhookEventSchema,
  GenderSchema,
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
    expect(() => ProfileInputSchema.parse({ first_name: 'Lee', bio: 'x'.repeat(501), prompts: [] })).toThrow();
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
