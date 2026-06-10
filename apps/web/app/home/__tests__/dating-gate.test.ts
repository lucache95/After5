import { describe, it, expect } from 'vitest';
import { datingGateMessage, displayGateReason } from '@/lib/onboarding/dating-gate';

describe('datingGateMessage', () => {
  it('maps birthdate_missing to a support-pointing message', () => {
    expect(datingGateMessage('birthdate_missing')).toMatch(/date of birth/i);
  });
  it('maps under_18 to an 18+ message', () => {
    expect(datingGateMessage('under_18')).toMatch(/18\+/);
  });
  it('has a safe default', () => {
    expect(datingGateMessage(undefined)).toMatch(/turn dating on|help/i);
  });
});

// P2 (2026-06-09 audit): birthdate only ever comes FROM the id scan. A user who
// never attempted/completed verification must read "not verified yet", never an
// invented "we couldn't read your id" failure.
describe('displayGateReason', () => {
  it('birthdate_missing + never-scanned (unverified/pending) → not_verified', () => {
    expect(displayGateReason('birthdate_missing', 'unverified')).toBe('not_verified');
    expect(displayGateReason('birthdate_missing', 'pending')).toBe('not_verified');
  });
  it('birthdate_missing after a REAL scan (verified/failed/appeal) keeps the id-read framing', () => {
    expect(displayGateReason('birthdate_missing', 'verified')).toBe('birthdate_missing');
    expect(displayGateReason('birthdate_missing', 'failed')).toBe('birthdate_missing');
    expect(displayGateReason('birthdate_missing', 'appeal')).toBe('birthdate_missing');
  });
  it('every other reason passes through untouched', () => {
    expect(displayGateReason('under_18', 'unverified')).toBe('under_18');
    expect(displayGateReason('not_verified', 'pending')).toBe('not_verified');
    expect(displayGateReason('onboarding_incomplete', 'unverified')).toBe('onboarding_incomplete');
    expect(displayGateReason(undefined, 'unverified')).toBeUndefined();
  });
});
