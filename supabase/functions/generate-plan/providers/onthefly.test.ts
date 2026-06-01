import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildWarmRows } from './onthefly.ts';

const city = { id: 'c1', slug: 'vernon', name: 'Vernon' } as any;
const ok = { id: 'a', displayName: { text: 'A' }, types: ['cafe'], rating: 4.5, userRatingCount: 40, businessStatus: 'OPERATIONAL', location: { latitude: 50.26, longitude: -119.27 } };
const lowRated = { ...ok, id: 'b', rating: 3.0 };
const dupe = { ...ok, id: 'a' };

Deno.test('buildWarmRows: applies quality floor + dedupes by google_place_id + tags city/auto/discovered', () => {
  const rows = buildWarmRows([ok, lowRated, dupe], city, 'GKEY');
  assertEquals(rows.length, 1);
  assertEquals(rows[0].google_place_id, 'a');
  assertEquals(rows[0].city_id, 'c1');
  assertEquals(rows[0].approval_status, 'auto');
  assertEquals(rows[0].source, 'discovered');
});
