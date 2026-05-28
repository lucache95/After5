import { describe, it, expect } from 'vitest';
import { feedColdStartTier } from '../feedColdStart';

describe('feedColdStartTier', () => {
  it('empty when no compatible nights', () => {
    expect(feedColdStartTier({ compatibleOpen: 0, totalOpen: 0 })).toBe('empty');
  });
  it('thin when few compatible nights exist', () => {
    expect(feedColdStartTier({ compatibleOpen: 2, totalOpen: 9 })).toBe('thin');
  });
  it('live when enough compatible nights', () => {
    expect(feedColdStartTier({ compatibleOpen: 8, totalOpen: 20 })).toBe('live');
  });
});
