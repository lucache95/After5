import { describe, it, expect } from 'vitest';
import { normalizeNightDetailStops } from './feed';

describe('normalizeNightDetailStops', () => {
  it('maps rich generated stops', () => {
    const out = normalizeNightDetailStops([
      {
        place_name: 'The Pub',
        place_type: 'cocktail_bar',
        start_time: '19:00',
        duration_min: 90,
        estimated_cost_pp: 28,
        what_to_do: 'split the charcuterie',
        neighborhood: 'Downtown',
        lat: 49.888,
        lng: -119.496,
        photo_url: 'p.jpg',
        local_insight: 'corner booth',
      },
    ]);
    expect(out[0]!.name).toBe('The Pub');
    expect(out[0]!.type).toBe('cocktail_bar');
    expect(out[0]!.cost_pp).toBe(28);
    expect(out[0]!.lat).toBe(49.888);
  });

  it('maps thin {name,type} legacy/seed stops without crashing', () => {
    const out = normalizeNightDetailStops([{ name: 'E2E Stop 1', type: 'cocktail_bar' }]);
    expect(out[0]!.name).toBe('E2E Stop 1');
    expect(out[0]!.type).toBe('cocktail_bar');
    expect(out[0]!.cost_pp).toBeNull();
  });

  it('returns [] for null/garbage', () => {
    expect(normalizeNightDetailStops(null)).toEqual([]);
    expect(normalizeNightDetailStops('nope' as unknown as unknown[])).toEqual([]);
  });
});
