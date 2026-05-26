// packages/business/src/__tests__/eligibility.test.ts
import { describe, it, expect } from 'vitest';
import { ageFromBirthdate, isAdult } from '../age';
import { canEnableDating, badgeFor, compatibilityPrefilterInputs } from '../eligibility';
describe('age', () => {
  it('computes age from birthdate at a reference date', () => {
    expect(ageFromBirthdate('2000-05-25', new Date('2026-05-25'))).toBe(26);
    expect(ageFromBirthdate('2000-05-26', new Date('2026-05-25'))).toBe(25);
  });
  it('isAdult is true at exactly 18', () => {
    expect(isAdult('2008-05-25', new Date('2026-05-25'))).toBe(true);
    expect(isAdult('2008-05-26', new Date('2026-05-25'))).toBe(false);
  });
});
describe('canEnableDating', () => {
  it('requires adult + verified + onboarding done', () => {
    const adult = { birthdate: '2000-01-01', verification: 'verified', onboarding_step: 'done' } as const;
    expect(canEnableDating(adult, new Date('2026-05-25')).ok).toBe(true);
    expect(canEnableDating({ ...adult, verification: 'pending' }, new Date('2026-05-25')).ok).toBe(false);
    expect(canEnableDating({ ...adult, birthdate: '2010-01-01' }, new Date('2026-05-25')).ok).toBe(false);
  });
});
describe('badgeFor', () => {
  it('Verified · New for a verified user with no established score', () => {
    expect(badgeFor({ verification: 'verified', reliability_score: null })).toEqual({ verified: true, isNew: true });
  });
  it('Verified (not New) once a reliability score exists', () => {
    expect(badgeFor({ verification: 'verified', reliability_score: 4.6 })).toEqual({ verified: true, isNew: false });
  });
  it('no badge for unverified', () => {
    expect(badgeFor({ verification: 'unverified', reliability_score: null })).toEqual({ verified: false, isNew: false });
  });
});
describe('compatibilityPrefilterInputs', () => {
  it('extracts exactly the inputs the Phase-4 feed needs', () => {
    const out = compatibilityPrefilterInputs({
      gender: 'woman', gender_preferences: ['man'],
      age_pref_lower: 25, age_pref_upper: 40, distance_pref_km: 35,
      dealbreakers: ['smoking'], primary_city_id: 'city-1',
    });
    expect(out).toEqual({
      viewerGender: 'woman', wantsGenders: ['man'],
      ageMin: 25, ageMax: 40, maxDistanceKm: 35, dealbreakers: ['smoking'], cityId: 'city-1',
    });
  });
});
