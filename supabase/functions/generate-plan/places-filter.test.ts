import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { withinRadius, admitsRow, ONTHEFLY_APPROVAL_STATUSES } from './places-filter.ts';

Deno.test('withinRadius: EXCLUDES places with null coords (DATA-03 Area 4), applies haversine otherwise', () => {
  const kel = { lat: 49.888, lng: -119.496 };
  // DATA-03 fail-loud: null coords now EXCLUDE — a venue we can't
  // proximity-validate must not silently pass as in-range.
  assertEquals(withinRadius(null, null, kel.lat, kel.lng, 30), false);  // unknown coords EXCLUDED
  assertEquals(withinRadius(49.89, -119.50, kel.lat, kel.lng, 30), true);
  assertEquals(withinRadius(51.05, -114.07, kel.lat, kel.lng, 30), false); // Calgary, far
});

// Area 2 (08-04): the candidate pool must never include relabeled Google rows —
// source='google_legacy' (per 08-03's discovered→google_legacy relabel) is the
// compliance point: no Google content may reach the LLM. admitsRow mirrors the
// filterPlaces select's source + approval_status predicate so it is unit-testable
// without a live DB.
Deno.test('admitsRow: EXCLUDES source=google_legacy from the candidate pool (Area 2)', () => {
  const statuses = ONTHEFLY_APPROVAL_STATUSES; // ['live','auto']
  assertEquals(admitsRow({ source: 'google_legacy', approval_status: 'live' }, statuses), false);
  assertEquals(admitsRow({ source: 'google_legacy', approval_status: 'auto' }, statuses), false);
});

// APPROVAL_STATUS (plan-check W3): a seed_city-warmed Foursquare row is written
// source='foursquare', approval_status='auto' (08-01). The any-city/onthefly
// read-path must pass approvalStatuses INCLUDING 'auto' on EVERY generation
// (not just cold-start), so an already-seeded city still admits its 'auto' rows.
Deno.test('admitsRow: ADMITS source=foursquare, approval_status=auto on the any-city read-path (W3)', () => {
  const statuses = ONTHEFLY_APPROVAL_STATUSES; // ['live','auto']
  assertEquals(admitsRow({ source: 'foursquare', approval_status: 'auto' }, statuses), true);
  assertEquals(admitsRow({ source: 'foursquare', approval_status: 'live' }, statuses), true);
  assertEquals(admitsRow({ source: 'curated', approval_status: 'live' }, statuses), true);
  // status not in the passed set → not admitted (mirrors the .in() clause)
  assertEquals(admitsRow({ source: 'foursquare', approval_status: 'draft' }, statuses), false);
});
