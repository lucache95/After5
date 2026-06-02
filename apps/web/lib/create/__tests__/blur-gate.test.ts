import { describe, it, expect } from 'vitest';
import { toTeaser, type GatedItinerary } from '../blur-gate';

const full = {
  template_id: 't1', template_name: 'tn', title: 'pottery + ramen',
  hook: 'hands dirty, then noodles', why_it_works: 'SECRET RATIONALE',
  total_cost_pp: 60, total_duration_min: 180, vibe: ['creative', 'foodie'],
  stops: [
    { place_id: 'p1', place_name: 'Clay Studio', place_type: 'activity', start_time: '18:00',
      duration_min: 90, estimated_cost_pp: 35, what_to_do: 'throw a bowl', photo_url: 'a.jpg',
      address: '1 St', neighborhood: 'Downtown', lat: 49.8, lng: -119.4, local_insight: 'ask for Mei' },
    { place_id: 'p2', place_name: 'Ramen Bar', place_type: 'restaurant', start_time: '20:00',
      duration_min: 60, estimated_cost_pp: 25, what_to_do: 'order tonkotsu', photo_url: 'b.jpg',
      address: '2 Ave', neighborhood: 'Pandosy', lat: 49.85, lng: -119.45, local_insight: 'cash only' },
  ],
};

describe('toTeaser', () => {
  it('authed: returns the full itinerary untouched', () => {
    const [t] = toTeaser([full], { authed: true });
    expect(t.why_it_works).toBe('SECRET RATIONALE');
    expect(t.stops[1].place_name).toBe('Ramen Bar');
    expect(t.locked).toBe(false);
  });

  it('anon: keeps hero + stop 1, strips why_it_works, silhouettes later stops', () => {
    const [t] = toTeaser([full], { authed: false });
    // hero-level: title + hook + cost + duration + vibe stay; rationale gone
    expect(t.title).toBe('pottery + ramen');
    expect(t.hook).toBe('hands dirty, then noodles');
    expect(t.why_it_works).toBe('');           // locked
    expect(t.locked).toBe(true);
    // stop 1 fully visible
    expect(t.stops[0].place_name).toBe('Clay Studio');
    expect(t.stops[0].what_to_do).toBe('throw a bowl');
    // stop 2 silhouetted: type + photo only, identifying fields stripped
    const s2 = t.stops[1];
    expect(s2.place_type).toBe('restaurant');
    expect(s2.photo_url).toBe('b.jpg');
    expect(s2.locked).toBe(true);
    expect(s2.place_name).toBe('');
    expect(s2.what_to_do).toBeUndefined();
    expect(s2.local_insight).toBeNull();
    expect(s2.address).toBeNull();
    expect(s2.lat).toBeNull();
    expect(s2.lng).toBeNull();
  });

  it('anon: gated strings never appear anywhere in the serialized teaser', () => {
    const json = JSON.stringify(toTeaser([full], { authed: false }));
    expect(json).not.toContain('SECRET RATIONALE');
    expect(json).not.toContain('Ramen Bar');
    expect(json).not.toContain('cash only');
    expect(json).not.toContain('tonkotsu');
  });
});
