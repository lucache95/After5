import { describe, it, expect, vi } from 'vitest';

// teaser.ts imports the admin client module; stub it so the pure mapper can be
// tested without env vars (teaserFeed itself is exercised by the e2e/local stack).
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { toTeaserNight, type TeaserRow } from '../teaser';

const row = (over: Partial<TeaserRow> = {}): TeaserRow => ({
  id: 'di-1',
  city_id: 'c-1',
  starts_at: '2026-06-16T01:46:00.732+00:00',
  is_seed: false,
  itineraries: {
    pay_setting: 'split',
    vibe_tags: ['cozy'],
    why_note: 'w',
    cover_image_url: null,
    title: 'E2E night',
  },
  cities: { name: 'Kelowna' },
  places: { neighborhood: 'Pandosy' },
  creator: { blurred_photo_url: 'u1/p1_blurred.jpg', first_name: 'Jordan', age: 30 },
  ...over,
});

describe('toTeaserNight (launch F1 — pre-verification teaser feed)', () => {
  it('maps a row into the FeedNight shape with neutral distance/ambient/fit', () => {
    const n = toTeaserNight(row());
    expect(n.date_instance_id).toBe('di-1');
    expect(n.city_id).toBe('c-1');
    expect(n.title).toBe('E2E night');
    expect(n.pay_setting).toBe('split');
    expect(n.vibe_tags).toEqual(['cozy']);
    expect(n.venue_neighborhood).toBe('Pandosy');
    expect(n.city_name).toBe('Kelowna');
    expect(n.distance_m).toBeNull();
    expect(n.ambient_sound_path).toBeNull();
    expect(n.ambient_sound_name).toBeNull();
    expect(n.fit).toBe(false);
  });

  it('hour-truncates starts_at (same time-blinding as the RPC date_trunc)', () => {
    const n = toTeaserNight(row({ starts_at: '2026-06-16T01:46:33.732+00:00' }));
    expect(n.time_window_start).toBe('2026-06-16T01:00:00.000Z');
  });

  it('host hint stays rung-1: blurred path + first name + age, nothing more', () => {
    const n = toTeaserNight(row());
    expect(n.host_blurred_photo_url).toBe('u1/p1_blurred.jpg');
    expect(n.host_first_name).toBe('Jordan');
    expect(n.host_age).toBe(30);
    // the FeedNight projection carries no creator/itinerary/venue identity keys
    expect(Object.keys(n)).not.toEqual(
      expect.arrayContaining(['creator_id', 'itinerary_id', 'venue_id', 'clear_photo_url']),
    );
  });

  it('degrades nulled joins to null fields, never throws', () => {
    const n = toTeaserNight(row({ itineraries: null, cities: null, places: null, creator: null }));
    expect(n.title).toBeNull();
    expect(n.city_name).toBeNull();
    expect(n.venue_neighborhood).toBeNull();
    expect(n.host_first_name).toBeNull();
    expect(n.host_blurred_photo_url).toBeNull();
  });
});
