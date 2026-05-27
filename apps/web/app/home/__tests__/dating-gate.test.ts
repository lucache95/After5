import { describe, it, expect } from 'vitest';
import { datingGateMessage } from '@/lib/onboarding/dating-gate';

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
