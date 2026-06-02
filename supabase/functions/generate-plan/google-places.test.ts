import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  mapGoogleTypes,
  priceLevelToTier,
  slugify,
  pickHours,
  passesQualityFloor,
  googleResultToPlaceRow,
} from './google-places.ts';

Deno.test('mapGoogleTypes: first-match-wins, falls back to activity', () => {
  assertEquals(mapGoogleTypes(['winery', 'restaurant']), 'winery');
  assertEquals(mapGoogleTypes(['cafe']), 'cafe');
  assertEquals(mapGoogleTypes(['bar', 'night_club']), 'cocktail_bar');
  assertEquals(mapGoogleTypes(['museum']), 'activity');
  assertEquals(mapGoogleTypes([]), 'activity');
});

Deno.test('priceLevelToTier maps Google enum strings', () => {
  assertEquals(priceLevelToTier('PRICE_LEVEL_FREE'), '$');
  assertEquals(priceLevelToTier('PRICE_LEVEL_MODERATE'), '$$');
  assertEquals(priceLevelToTier('PRICE_LEVEL_VERY_EXPENSIVE'), '$$$');
  assertEquals(priceLevelToTier(undefined), '$$');
});

Deno.test('slugify lowercases, strips accents/punct, trims dashes', () => {
  assertEquals(slugify('Café Médina!'), 'cafe-medina');
});

Deno.test('pickHours parses a weekday description range', () => {
  const h = pickHours({ weekdayDescriptions: ['Wednesday: 11:00 AM – 10:00 PM'] });
  assertEquals(h, { opens: '11:00', closes: '22:00' });
});

Deno.test('passesQualityFloor enforces rating>=4, reviews>=20, OPERATIONAL', () => {
  const base = { rating: 4.5, userRatingCount: 30, businessStatus: 'OPERATIONAL' };
  assertEquals(passesQualityFloor(base), true);
  assertEquals(passesQualityFloor({ ...base, rating: 3.9 }), false);
  assertEquals(passesQualityFloor({ ...base, userRatingCount: 19 }), false);
  assertEquals(passesQualityFloor({ ...base, businessStatus: 'CLOSED_PERMANENTLY' }), false);
});

Deno.test('googleResultToPlaceRow maps a result into a places row scoped to a city', () => {
  const row = googleResultToPlaceRow(
    {
      id: 'g123',
      displayName: { text: 'The Test Cafe' },
      formattedAddress: '1 Main St',
      location: { latitude: 49.88, longitude: -119.49 },
      types: ['cafe'],
      priceLevel: 'PRICE_LEVEL_MODERATE',
      rating: 4.4,
      userRatingCount: 51,
      businessStatus: 'OPERATIONAL',
      photos: [{ name: 'places/g123/photos/abc' }],
      regularOpeningHours: { weekdayDescriptions: ['Wednesday: 8:00 AM – 4:00 PM'] },
      websiteUri: 'https://x.test',
    },
    { id: 'city-uuid', slug: 'vernon' },
    'GKEY',
  );
  assertEquals(row.google_place_id, 'g123');
  assertEquals(row.type, 'cafe');
  assertEquals(row.price_tier, '$$');
  assertEquals(row.city_id, 'city-uuid');
  assertEquals(row.source, 'discovered');
  assertEquals(row.approval_status, 'auto');
  assertEquals(row.is_active, true);
  assertEquals(row.opens, '08:00');
  assertEquals(row.lat, 49.88);
  assertEquals(typeof row.photo_url, 'string');
  assertEquals(row.slug.startsWith('the-test-cafe-'), true); // suffixed with id tail
});
