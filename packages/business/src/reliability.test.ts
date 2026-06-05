import { describe, it, expect } from 'vitest';
import { computeReliability, type ReliabilityDate } from './reliability';
import { badgeFor, MIN_RATINGS_FOR_ESTABLISHED } from './eligibility';

// A rated date where everything went well.
const perfect: ReliabilityDate = {
  showed_up: true,
  on_time: true,
  cancelled_with_notice: false,
  unsafe_or_disrespectful: false,
};

describe('computeReliability', () => {
  it('scores a ratee with 3 all-good rated dates near 100', () => {
    const score = computeReliability([perfect, perfect, perfect]);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThanOrEqual(95);
    expect(score!).toBeLessThanOrEqual(100);
    expect(Number.isInteger(score!)).toBe(true);
  });

  it('scores a ratee with 3 no_show dates 0, and NOT new (>=3 dates counted)', () => {
    const score = computeReliability([{ no_show: true }, { no_show: true }, { no_show: true }]);
    expect(score).toBe(0);
  });

  it('returns null (new member) when fewer than 3 total rated+no_show dates', () => {
    expect(computeReliability([perfect, perfect])).toBeNull();
    expect(computeReliability([perfect, { no_show: true }])).toBeNull();
    expect(computeReliability([])).toBeNull();
  });

  it('applies a hard penalty to an unsafe_or_disrespectful date, floored at 0', () => {
    const unsafe: ReliabilityDate = {
      showed_up: true,
      on_time: true,
      cancelled_with_notice: false,
      unsafe_or_disrespectful: true,
    };
    // One unsafe date among three otherwise-perfect dates drags the average down
    // well below the all-perfect score; an all-unsafe set floors at 0.
    const mixed = computeReliability([perfect, perfect, unsafe]);
    const allUnsafe = computeReliability([unsafe, unsafe, unsafe]);
    expect(mixed!).toBeLessThan(95);
    expect(allUnsafe).toBe(0);
  });

  it('honors the >=3 threshold constant', () => {
    expect(MIN_RATINGS_FOR_ESTABLISHED).toBe(3);
  });
});

describe('badgeFor', () => {
  it('marks a verified profile with no reliability_score as new', () => {
    expect(badgeFor({ verification: 'verified', reliability_score: null }).isNew).toBe(true);
  });

  it('marks a verified profile with a reliability_score as established', () => {
    expect(badgeFor({ verification: 'verified', reliability_score: 94 }).isNew).toBe(false);
  });
});
