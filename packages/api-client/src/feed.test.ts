import { describe, it, expect, vi } from 'vitest';
import { normalizeNightDetailStops, browseFeed, type FeedNight } from './feed';
import type { After5Client } from './index';

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

describe('browseFeed host hint (E15 / REQ-E15 / D-01)', () => {
  it('exposes the 3 host-hint fields on a mapped feed row', async () => {
    const row = {
      date_instance_id: 'di-1', city_id: 'c-1', time_window_start: '2026-06-10T19:00:00Z',
      pay_setting: 'split', vibe_tags: ['cozy'], why_note: 'low-key', cover_image_url: null,
      title: 'a night out', venue_neighborhood: 'Downtown', is_seed: false, distance_m: 1200,
      ambient_sound_path: null, ambient_sound_name: null, fit: true,
      // the widened RPC returns the relative blurred PATH + first name + age.
      host_blurred_photo_url: 'host-uid/photo_blurred.jpg',
      host_first_name: 'maya',
      host_age: 27,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const client = { rpc } as unknown as After5Client;

    const out: FeedNight[] = await browseFeed(client, { limit: 1 });
    expect(rpc).toHaveBeenCalledWith('browse_feed_for_viewer', expect.objectContaining({ p_limit: 1 }));
    expect(out[0]!.host_blurred_photo_url).toBe('host-uid/photo_blurred.jpg');
    expect(out[0]!.host_first_name).toBe('maya');
    expect(out[0]!.host_age).toBe(27);
  });

  it('tolerates a null host hint (host with no photo / age)', async () => {
    const row = {
      date_instance_id: 'di-2', city_id: 'c-1', time_window_start: '2026-06-10T19:00:00Z',
      pay_setting: null, vibe_tags: null, why_note: null, cover_image_url: null,
      title: null, venue_neighborhood: null, is_seed: false, distance_m: null,
      ambient_sound_path: null, ambient_sound_name: null, fit: false,
      host_blurred_photo_url: null, host_first_name: null, host_age: null,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const client = { rpc } as unknown as After5Client;
    const out = await browseFeed(client);
    expect(out[0]!.host_blurred_photo_url).toBeNull();
    expect(out[0]!.host_first_name).toBeNull();
    expect(out[0]!.host_age).toBeNull();
  });
});
