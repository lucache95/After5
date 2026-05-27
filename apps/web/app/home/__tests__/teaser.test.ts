import { describe, it, expect } from 'vitest';
import { homeState, primaryActionFor, itineraryToTeaser, type HomeState } from '@/lib/onboarding/teaser';

describe('homeState', () => {
  it('failed verification wins over everything', () => {
    expect(homeState({ verification: 'failed', dating_enabled: true })).toBe<HomeState>('failed');
  });
  it('pending verification shows the pending home', () => {
    expect(homeState({ verification: 'pending', dating_enabled: true })).toBe<HomeState>('pending');
  });
  it('verified but dating off → dating_off', () => {
    expect(homeState({ verification: 'verified', dating_enabled: false })).toBe<HomeState>('dating_off');
  });
  it('verified + dating on → verified (primary state)', () => {
    expect(homeState({ verification: 'verified', dating_enabled: true })).toBe<HomeState>('verified');
  });
});

describe('primaryActionFor', () => {
  it('gives exactly one action keyed to state (no dead ends)', () => {
    expect(primaryActionFor('verified').kind).toBe('explore');
    expect(primaryActionFor('dating_off').kind).toBe('enable_dating');
    expect(primaryActionFor('pending').kind).toBe('look_around');
    expect(primaryActionFor('failed').kind).toBe('retry_verification');
  });
});

describe('itineraryToTeaser', () => {
  it('maps a public itinerary row to a teaser card', () => {
    const card = itineraryToTeaser({
      id: 'i1', slug: 'sunset-walk', title: 'Sunset Walk', hook: 'Lakeside',
      total_cost_pp: 40, total_duration_min: 120, stops: [], cover_image_url: '/c.jpg',
    });
    expect(card).toEqual({ id: 'i1', href: '/dates/sunset-walk', title: 'Sunset Walk', hook: 'Lakeside', cover: '/c.jpg', costPp: 40, durationMin: 120 });
  });
  it('falls back to /dates when no slug', () => {
    const card = itineraryToTeaser({ id: 'i2', slug: null, title: 'X', hook: null, total_cost_pp: null, total_duration_min: null, stops: [], cover_image_url: null });
    expect(card.href).toBe('/dates');
  });
});
