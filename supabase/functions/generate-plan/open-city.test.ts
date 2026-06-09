import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { openCitySlug, displayNameFromGeocode, resolveOpenCity, OpenCityError } from './open-city.ts';

Deno.test('openCitySlug: deterministic, prefixed, slug-safe', () => {
  assertEquals(openCitySlug('Portland, OR'), 'open-portland-or');
  assertEquals(openCitySlug('São Paulo'), 'open-sao-paulo');
  assertEquals(openCitySlug('  '), 'open-city');
});

Deno.test('displayNameFromGeocode: takes the first address segment', () => {
  assertEquals(displayNameFromGeocode('Portland, OR, USA', 'portland'), 'Portland');
  assertEquals(displayNameFromGeocode('', 'austin'), 'austin');
});

Deno.test('resolveOpenCity: blank query → 422', async () => {
  await assertRejects(
    () => resolveOpenCity('   ', {} as never, { fsqKey: 'k' }),
    OpenCityError,
    'Type a city',
  );
});

Deno.test('resolveOpenCity: no foursquare key → 503', async () => {
  await assertRejects(
    () => resolveOpenCity('Austin', {} as never, { fsqKey: undefined }),
    OpenCityError,
    'not configured',
  );
});

Deno.test('resolveOpenCity: reuses an existing ad-hoc row without geocoding', async () => {
  const existing = {
    id: 'c1', slug: 'open-austin', name: 'Austin', region: 'Austin, TX, USA',
    timezone: 'UTC', centroid_lat: 30.26, centroid_lng: -97.74, default_radius_km: 25,
  };
  const supabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: existing, error: null }); },
      };
    },
  };
  const city = await resolveOpenCity('Austin', supabase as never, { fsqKey: 'k' });
  assertEquals(city.id, 'c1');
  assertEquals(city.centroid_lat, 30.26);
});
