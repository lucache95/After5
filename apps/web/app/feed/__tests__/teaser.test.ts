import { describe, it, expect, vi } from 'vitest';

// teaser.ts imports the admin client module; stub it so the pure mapper can be
// tested without env vars (teaserFeed itself is exercised by the e2e/local stack).
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import {
  toTeaserNight, dealbreakerBlocks, teaserVisible,
  type TeaserRow, type TeaserViewer,
} from '../teaser';

const NO_FACTS = { dealbreakers: null, smokes: null, drinks: null, has_pets: null, wants_kids: null };

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
  creator: { blurred_photo_url: 'u1/p1_blurred.jpg', first_name: 'Jordan', age: 30, ...NO_FACTS },
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

  it('DLB: never projects the server-only dealbreaker/fact filter inputs', () => {
    const n = toTeaserNight(row());
    expect(Object.keys(n)).not.toEqual(
      expect.arrayContaining(['dealbreakers', 'smokes', 'drinks', 'has_pets', 'wants_kids']),
    );
  });
});

// ── DLB: app-side mirror of SQL dealbreaker_blocks (dlb02 migration) ──────────
describe('dealbreakerBlocks (mirror of the SQL helper)', () => {
  const facts = (over: Partial<TeaserViewer> = {}) =>
    ({ smokes: null, drinks: null, has_pets: null, wants_kids: null, ...over });

  it.each([
    ['smoking', { smokes: true }],
    ['drinks_alcohol', { drinks: true }],
    ['no_alcohol', { drinks: false }],
    ['has_pets', { has_pets: true }],
    ['no_pets', { has_pets: false }],
    ['wants_kids', { wants_kids: true }],
    ['no_kids', { wants_kids: false }],
  ] as const)('%s blocks its offending fact value', (tag, offending) => {
    expect(dealbreakerBlocks([tag], facts(offending))).toBe(true);
  });

  it('null (unanswered) facts NEVER block, even with every tag set', () => {
    const all = ['smoking', 'drinks_alcohol', 'no_alcohol', 'has_pets', 'no_pets', 'wants_kids', 'no_kids'];
    expect(dealbreakerBlocks(all, facts())).toBe(false);
  });

  it('wrong-polarity facts pass', () => {
    expect(dealbreakerBlocks(['smoking'], facts({ smokes: false }))).toBe(false);
    expect(dealbreakerBlocks(['no_alcohol'], facts({ drinks: true }))).toBe(false);
  });

  it('empty / null dealbreakers block nothing, even with offending facts', () => {
    const offending = facts({ smokes: true, drinks: true, has_pets: true, wants_kids: true });
    expect(dealbreakerBlocks([], offending)).toBe(false);
    expect(dealbreakerBlocks(null, offending)).toBe(false);
    expect(dealbreakerBlocks(undefined, offending)).toBe(false);
  });
});

describe('teaserVisible (mutual gate, both directions)', () => {
  const viewer = (over: Partial<TeaserViewer> = {}): TeaserViewer =>
    ({ dealbreakers: null, smokes: null, drinks: null, has_pets: null, wants_kids: null, ...over });

  it('viewer hard no hides an offending host', () => {
    const r = row({ creator: { blurred_photo_url: null, first_name: 'J', age: 30, ...NO_FACTS, smokes: true } });
    expect(teaserVisible(r, viewer({ dealbreakers: ['smoking'] }))).toBe(false);
  });

  it("host hard no mirrors back on the viewer's facts", () => {
    const r = row({ creator: { blurred_photo_url: null, first_name: 'J', age: 30, ...NO_FACTS, dealbreakers: ['no_alcohol'] } });
    expect(teaserVisible(r, viewer({ drinks: false }))).toBe(false);
    expect(teaserVisible(r, viewer({ drinks: true }))).toBe(true);
    expect(teaserVisible(r, viewer())).toBe(true); // unanswered never trips
  });

  it('no viewer row / no dealbreakers = everything visible', () => {
    expect(teaserVisible(row(), null)).toBe(true);
    expect(teaserVisible(row(), viewer())).toBe(true);
  });
});
