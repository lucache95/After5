import { describe, it, expect } from 'vitest';
import { nightCountdown } from './countdown';

// Local-time constructor args (not ISO strings) keep the calendar-day math
// deterministic regardless of the runner's TZ.
const now = new Date(2026, 5, 9, 19, 0); // tue jun 9, 7pm local

describe('nightCountdown', () => {
  it('same calendar day → tonight', () => {
    expect(nightCountdown(new Date(2026, 5, 9, 21, 0), now)).toBe('tonight');
  });

  it('the exact same instant still counts as tonight', () => {
    expect(nightCountdown(new Date(now.getTime()), now)).toBe('tonight');
  });

  it('next calendar day → tomorrow, even when it is hours away', () => {
    // 1am tomorrow is 6h out but a different calendar day — "tomorrow", not "tonight".
    expect(nightCountdown(new Date(2026, 5, 10, 1, 0), now)).toBe('tomorrow');
    expect(nightCountdown(new Date(2026, 5, 10, 19, 0), now)).toBe('tomorrow');
  });

  it('counts calendar days, not 24h windows', () => {
    // 29.5h away but two calendar-day boundaries crossed → "in 2 days".
    expect(nightCountdown(new Date(2026, 5, 11, 0, 30), now)).toBe('in 2 days');
    expect(nightCountdown(new Date(2026, 5, 12, 19, 0), now)).toBe('in 3 days');
  });

  it('past start → empty string (the night already left the feed)', () => {
    expect(nightCountdown(new Date(2026, 5, 9, 18, 0), now)).toBe('');
    expect(nightCountdown(new Date(2026, 5, 1, 19, 0), now)).toBe('');
  });

  it('accepts an ISO string input', () => {
    expect(nightCountdown(new Date(2026, 5, 10, 19, 0).toISOString(), now)).toBe('tomorrow');
  });

  it('null / undefined / unparseable → empty string', () => {
    expect(nightCountdown(null, now)).toBe('');
    expect(nightCountdown(undefined, now)).toBe('');
    expect(nightCountdown('not-a-date', now)).toBe('');
  });
});
