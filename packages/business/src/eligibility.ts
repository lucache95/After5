// packages/business/src/eligibility.ts
import { isAdult } from './age';
export type VerificationState = 'unverified' | 'pending' | 'verified' | 'failed' | 'appeal';
export const MIN_RATINGS_FOR_ESTABLISHED = 3;
export interface DatingGateInput { birthdate: string | null; verification: VerificationState; onboarding_step: string; }
export function canEnableDating(p: DatingGateInput, at: Date = new Date()): { ok: boolean; reason?: string } {
  if (!p.birthdate) return { ok: false, reason: 'birthdate_missing' };
  if (!isAdult(p.birthdate, at)) return { ok: false, reason: 'under_18' };
  if (p.verification !== 'verified') return { ok: false, reason: 'not_verified' };
  if (p.onboarding_step !== 'done') return { ok: false, reason: 'onboarding_incomplete' };
  return { ok: true };
}
export interface BadgeInput { verification: VerificationState; reliability_score: number | null; }
export function badgeFor(p: BadgeInput): { verified: boolean; isNew: boolean } {
  const verified = p.verification === 'verified';
  return { verified, isNew: verified && (p.reliability_score == null) };
}
export interface PrefilterRow {
  gender: string | null; gender_preferences: string[];
  age_pref_lower: number | null; age_pref_upper: number | null;
  distance_pref_km: number; dealbreakers: string[]; primary_city_id: string | null;
}
export function compatibilityPrefilterInputs(row: PrefilterRow) {
  return {
    viewerGender: row.gender, wantsGenders: row.gender_preferences,
    ageMin: row.age_pref_lower, ageMax: row.age_pref_upper,
    maxDistanceKm: row.distance_pref_km, dealbreakers: row.dealbreakers, cityId: row.primary_city_id,
  };
}
