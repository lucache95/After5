import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  mapFsqCategories,
  passesQualityFloor,
  pickHours,
  priceToTier,
} from './foursquare.ts';
import {
  belowFloorVenue,
  nullHoursVenue,
  richVenue,
} from './__fixtures__/foursquare.ts';

// ─── pickHours (the #1 silent-failure risk — RESEARCH Pitfall 1) ──────────

Deno.test('pickHours: picks the Wednesday (day===3) entry and formats HHMM→HH:MM', () => {
  const got = pickHours({ regular: [{ day: 3, open: '1100', close: '2200' }] });
  assertEquals(got, { opens: '11:00', closes: '22:00' });
});

Deno.test('pickHours: prefers day===3 over a preceding day, else first entry', () => {
  // richVenue has Mon(1), Wed(3), Fri(5) — must select Wed.
  assertEquals(pickHours(richVenue.hours), { opens: '11:00', closes: '22:00' });
  // No Wednesday → falls back to the first entry.
  const noWed = pickHours({ regular: [{ day: 1, open: '1600', close: '2300' }] });
  assertEquals(noWed, { opens: '16:00', closes: '23:00' });
});

Deno.test('pickHours: empty/missing regular → {opens:null, closes:null}', () => {
  assertEquals(pickHours(undefined), { opens: null, closes: null });
  assertEquals(pickHours({ regular: [] }), { opens: null, closes: null });
  assertEquals(pickHours({}), { opens: null, closes: null });
});

Deno.test('pickHours: malformed time strings → null (not a crash, not "00:00")', () => {
  assertEquals(pickHours({ regular: [{ day: 3, open: 'abc', close: '22:00' }] }), {
    opens: null,
    closes: null,
  });
  // Partial / wrong-length strings also null out, never coerce to 00:00.
  assertEquals(pickHours({ regular: [{ day: 3, open: '900', close: '17000' }] }), {
    opens: null,
    closes: null,
  });
});

// ─── mapFsqCategories ─────────────────────────────────────────────────────

Deno.test('mapFsqCategories: maps known category names to place_type enum', () => {
  assertEquals(mapFsqCategories([{ name: 'Coffee Shop' }]), 'cafe');
  assertEquals(mapFsqCategories([{ name: 'Cocktail Bar' }]), 'cocktail_bar');
  assertEquals(mapFsqCategories([{ name: 'Winery' }]), 'winery');
  assertEquals(mapFsqCategories([{ name: 'Art Gallery' }]), 'gallery');
  assertEquals(mapFsqCategories([{ name: 'Hiking Trail' }]), 'hike');
});

Deno.test('mapFsqCategories: unknown / empty → activity fallback', () => {
  assertEquals(mapFsqCategories([{ name: 'Quantum Laundromat' }]), 'activity');
  assertEquals(mapFsqCategories([]), 'activity');
  assertEquals(mapFsqCategories(undefined), 'activity');
});

// ─── priceToTier ──────────────────────────────────────────────────────────

Deno.test('priceToTier: 1→$, 2→$$, 3/4→$$$, undefined→$$', () => {
  assertEquals(priceToTier(1), '$');
  assertEquals(priceToTier(2), '$$');
  assertEquals(priceToTier(3), '$$$');
  assertEquals(priceToTier(4), '$$$');
  assertEquals(priceToTier(undefined), '$$');
});

// ─── passesQualityFloor (FSQ rating is 0–10; floor is >=7.0 — Pitfall 3) ───

Deno.test('passesQualityFloor: rating>=7.0 passes, 6.9 fails', () => {
  assertEquals(passesQualityFloor({ rating: 7.0 }), true);
  assertEquals(passesQualityFloor(richVenue), true); // 8.4
  assertEquals(passesQualityFloor({ rating: 6.9 }), false);
  assertEquals(passesQualityFloor(belowFloorVenue), false); // 5.0
});

Deno.test('passesQualityFloor: a present date_closed fails regardless of rating', () => {
  assertEquals(passesQualityFloor({ rating: 9.5, date_closed: '2025-01-01' }), false);
});

Deno.test('passesQualityFloor: missing rating fails (not silently admitted)', () => {
  assertEquals(passesQualityFloor(nullHoursVenue), true); // 7.8 passes
  assertEquals(passesQualityFloor({}), false);
});
