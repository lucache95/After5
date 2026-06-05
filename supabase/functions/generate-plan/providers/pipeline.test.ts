import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { computeUnverifiedRate } from './unverified-rate.ts';
import type { Place } from '../types.ts';

// Minimal Place factory — only coords + hours matter for unverified_rate.
function makePlace(overrides: Partial<Place>): Place {
  return {
    id: 'p',
    name: 'P',
    slug: 'p',
    address: null,
    neighborhood: 'Downtown',
    drive_cluster: 'core',
    type: 'cafe',
    vibe_tags: [],
    pairing_tags: [],
    effort: 'low',
    time_of_day: ['all_day'],
    weather_dependent: false,
    seasonality: ['year_round'],
    typical_duration_min: 60,
    price_tier: '$',
    typical_per_person: 10,
    reservation_required: false,
    reservation_url: null,
    photo_url: null,
    lat: 49.88,
    lng: -119.49,
    opens: '08:00',
    closes: '20:00',
    quality_score: 5,
    feedback_score: 1,
    local_insight: null,
    notes: null,
    ...overrides,
  };
}

Deno.test('computeUnverifiedRate: 1 null-coord + 1 null-hours of 4 → 0.5', () => {
  const pool = [
    makePlace({ id: 'a', lat: null, lng: null }),   // null coords
    makePlace({ id: 'b', opens: null, closes: null }), // null hours
    makePlace({ id: 'c' }),                           // valid
    makePlace({ id: 'd' }),                           // valid
  ];
  assertEquals(computeUnverifiedRate(pool), 0.5);
});

Deno.test('computeUnverifiedRate: all-valid pool → 0', () => {
  const pool = [makePlace({ id: 'a' }), makePlace({ id: 'b' })];
  assertEquals(computeUnverifiedRate(pool), 0);
});

Deno.test('computeUnverifiedRate: empty pool → 0 (no divide-by-zero)', () => {
  assertEquals(computeUnverifiedRate([]), 0);
});

Deno.test('computeUnverifiedRate: a place missing both coords and hours counts once', () => {
  const pool = [
    makePlace({ id: 'a', lat: null, lng: null, opens: null, closes: null }),
    makePlace({ id: 'b' }),
  ];
  assertEquals(computeUnverifiedRate(pool), 0.5);
});
