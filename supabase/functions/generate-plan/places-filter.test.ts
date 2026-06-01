import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { withinRadius } from './places-filter.ts';

Deno.test('withinRadius: keeps places with null coords, applies haversine otherwise', () => {
  const kel = { lat: 49.888, lng: -119.496 };
  assertEquals(withinRadius(null, null, kel.lat, kel.lng, 30), true);   // unknown coords pass
  assertEquals(withinRadius(49.89, -119.50, kel.lat, kel.lng, 30), true);
  assertEquals(withinRadius(51.05, -114.07, kel.lat, kel.lng, 30), false); // Calgary, far
});
