import {
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  fsqResultToPlaceRow,
  mapFsqCategories,
  passesQualityFloor,
  pickHours,
  priceToTier,
  searchPlaces,
} from './foursquare.ts';
import {
  belowFloorVenue,
  nullCoordsVenue,
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

// ─── searchPlaces request shape (mock fetchImpl — Pitfall 6 auth-drift guard) ─

Deno.test('searchPlaces: sends new-API auth + ll/radius/categories/fields; returns results', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  const stub: typeof fetch = (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedHeaders = ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
    return Promise.resolve(
      new Response(JSON.stringify({ results: [richVenue] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };

  const results = await searchPlaces(
    { apiKey: 'test-key', lat: 49.888, lng: -119.496, radiusKm: 25, categoryIds: 'cat-a,cat-b', limit: 30 },
    stub,
  );

  assertEquals(results, [richVenue]);

  const url = new URL(capturedUrl);
  assertEquals(url.host, 'places-api.foursquare.com');
  assertEquals(url.pathname, '/places/search');
  assertEquals(url.searchParams.get('ll'), '49.888,-119.496');
  assertEquals(url.searchParams.get('radius'), '25000'); // km*1000, meters
  assertEquals(url.searchParams.get('fsq_category_ids'), 'cat-a,cat-b');
  assertEquals(url.searchParams.get('limit'), '30');
  const fields = url.searchParams.get('fields') ?? '';
  assertStringIncludes(fields, 'hours');
  assertStringIncludes(fields, 'fsq_place_id');

  assertEquals(capturedHeaders['Authorization'], 'Bearer test-key');
  assertEquals(capturedHeaders['X-Places-Api-Version'], '2025-06-17');
});

// ─── Null-data mapping (Pitfall 1 regression guard — relied on by 08-02/04) ──

Deno.test('fsqResultToPlaceRow(richVenue): full row with fsq_place_id, source, no x2 rating', () => {
  const row = fsqResultToPlaceRow(richVenue, { id: 'city-1', slug: 'kelowna' }, 'k');
  assertEquals(row.fsq_place_id, 'fsq-rich-001abc');
  assertEquals(row.source, 'foursquare');
  assertEquals(row.approval_status, 'auto');
  assertEquals(row.lat, 49.8881);
  assertEquals(row.lng, -119.4962);
  assertEquals(row.opens, '11:00');
  assertEquals(row.closes, '22:00');
  assertEquals(row.type, 'cocktail_bar');
  assertEquals(row.price_tier, '$$');
  assertEquals(row.quality_score, 8); // round(8.4), NOT x2
});

Deno.test('fsqResultToPlaceRow(nullCoordsVenue): lat/lng null, no crash', () => {
  const row = fsqResultToPlaceRow(nullCoordsVenue, { id: 'city-1', slug: 'kelowna' }, 'k');
  assertEquals(row.lat, null);
  assertEquals(row.lng, null);
  assertEquals(row.fsq_place_id, 'fsq-nullcoords-003');
});

Deno.test('fsqResultToPlaceRow(nullHoursVenue): opens/closes null (not 00:00)', () => {
  const row = fsqResultToPlaceRow(nullHoursVenue, { id: 'city-1', slug: 'kelowna' }, 'k');
  assertEquals(row.opens, null);
  assertEquals(row.closes, null);
});

Deno.test('fsqResultToPlaceRow: non-Kelowna city → neighborhood=slug, drive_cluster=multiple', () => {
  const row = fsqResultToPlaceRow(richVenue, { id: 'city-9', slug: 'portland' }, 'k');
  assertEquals(row.neighborhood, 'portland');
  assertEquals(row.drive_cluster, 'multiple');
});

// ─── Live integration (key-gated; CI skips when no FOURSQUARE_API_KEY) ──────

Deno.test('live: searchPlaces against real Foursquare (skipped without key)', async () => {
  // Skip when the key is absent OR the env permission isn't granted, so the
  // plain `deno test` (no --allow-env) stays green in CI with no live key.
  let key: string | undefined;
  try {
    key = Deno.env.get('FOURSQUARE_API_KEY');
  } catch {
    return; // env permission denied → skip
  }
  if (!key) return; // no key → skip in CI
  const results = await searchPlaces({
    apiKey: key, lat: 49.888, lng: -119.496, radiusKm: 10,
    categoryIds: '4d4b7105d754a06374d81259', limit: 5,
  });
  assertEquals(Array.isArray(results), true);
});
