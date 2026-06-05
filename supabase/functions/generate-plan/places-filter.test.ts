import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { withinRadius } from './places-filter.ts';

Deno.test('withinRadius: EXCLUDES places with null coords (DATA-03 Area 4), applies haversine otherwise', () => {
  const kel = { lat: 49.888, lng: -119.496 };
  // DATA-03 fail-loud: null coords now EXCLUDE — a venue we can't
  // proximity-validate must not silently pass as in-range.
  assertEquals(withinRadius(null, null, kel.lat, kel.lng, 30), false);  // unknown coords EXCLUDED
  assertEquals(withinRadius(49.89, -119.50, kel.lat, kel.lng, 30), true);
  assertEquals(withinRadius(51.05, -114.07, kel.lat, kel.lng, 30), false); // Calgary, far
});
