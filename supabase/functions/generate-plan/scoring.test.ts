import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildItineraryFromTemplate, isOpenAt, withinHop, MAX_HOP_KM, categoryGroupForType } from './scoring.ts';
import { haversineKm } from './places-filter.ts';
import type { Place, PlanInputs, Template } from './types.ts';

// Minimal Place factory — only the fields scoring/assembly touch matter; the
// rest get harmless defaults so we can vary opens/closes/coords per test.
function makePlace(overrides: Partial<Place>): Place {
  return {
    id: 'p1',
    name: 'Test Place',
    slug: 'test-place',
    address: '1 Main St',
    neighborhood: 'Downtown',
    drive_cluster: 'core',
    type: 'cafe',
    vibe_tags: [],
    pairing_tags: [],
    effort: 'low',
    time_of_day: ['morning', 'all_day', 'evening'],
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
    is_active: true,
    ...overrides,
  };
}

// ─── isOpenAt: fail-loud on null hours for a timed slot ─────────────────

Deno.test('isOpenAt: null hours + timed slot is EXCLUDED (DATA-03, was silently open)', () => {
  const p = makePlace({ opens: null, closes: null });
  assertEquals(isOpenAt(p, '18:00'), false);
});

Deno.test('isOpenAt: relaxed mode (empty slotStart) still admits null-hours venue', () => {
  // Relaxed retry path — the exact behavior this phase MUST preserve so thin/
  // cold cities can still fill itineraries when the hours filter is too tight.
  const p = makePlace({ opens: null, closes: null });
  assertEquals(isOpenAt(p, ''), true);
});

Deno.test('isOpenAt: same-day window honored', () => {
  const p = makePlace({ opens: '17:00', closes: '22:00' });
  assertEquals(isOpenAt(p, '18:00'), true);
  assertEquals(isOpenAt(p, '12:00'), false);
});

Deno.test('isOpenAt: wraparound window honored', () => {
  const p = makePlace({ opens: '17:00', closes: '01:00' });
  assertEquals(isOpenAt(p, '23:00'), true);
});

// ─── unverified marker threads to the stop ──────────────────────────────

const SINGLE_SLOT_TEMPLATE: Template = {
  id: 't1',
  name: 'one stop',
  duration_min: 60,
  suitable_for: ['date'],
  vibe: [],
  slots: [{ types: ['cafe'], duration_min: 60 }],
  geographic_rule: null,
  energy_curve: null,
};

const BASE_INPUTS: PlanInputs = {
  occasion: 'date',
  duration_min: 120,
  budget_per_person: 80,
  vibe: [],
  must_includes: [],
  drive_tolerance_min: 30,
  max_radius_km: 30,
  location: 'out',
  effort: 'low',
};

Deno.test('buildItineraryFromTemplate: null-hours place admitted via relaxed path carries unverified:true', () => {
  const nullHours = makePlace({ id: 'nh', opens: null, closes: null });
  // 10:00 start: the evening-coffee gate (cafe ≥17:00) must not interfere here.
  const it = buildItineraryFromTemplate(
    SINGLE_SLOT_TEMPLATE,
    [nullHours],
    BASE_INPUTS,
    '10:00',
    new Set(),
    { skipHoursFilter: true },
  );
  assertEquals(it !== null, true);
  assertEquals(it!.stops.length, 1);
  assertEquals(it!.stops[0].unverified, true);
});

Deno.test('buildItineraryFromTemplate: fully-specified place is not unverified', () => {
  const ok = makePlace({ id: 'ok', opens: '08:00', closes: '20:00' });
  const it = buildItineraryFromTemplate(
    SINGLE_SLOT_TEMPLATE,
    [ok],
    BASE_INPUTS,
    '10:00',
    new Set(),
    {},
  );
  assertEquals(it !== null, true);
  assertEquals(it!.stops[0].unverified, false);
});

// ─── withinHop: haversine consecutive-stop adjacency gate (PLAN-01) ──────

// ~0.6 km apart in Kelowna downtown (well within MAX_HOP_KM).
const NEAR_A = makePlace({ id: 'na', lat: 49.8880, lng: -119.4960 });
const NEAR_B = makePlace({ id: 'nb', lat: 49.8920, lng: -119.4920 });
// ~7 km away (well over MAX_HOP_KM).
const FAR = makePlace({ id: 'far', lat: 49.9400, lng: -119.4000 });

Deno.test('withinHop: true when consecutive stops are within MAX_HOP_KM', () => {
  // sanity: the two near places really are under the threshold
  assertEquals(haversineKm(NEAR_A.lat!, NEAR_A.lng!, NEAR_B.lat!, NEAR_B.lng!) <= MAX_HOP_KM, true);
  assertEquals(withinHop(NEAR_A, NEAR_B), true);
});

Deno.test('withinHop: false when consecutive stops exceed MAX_HOP_KM', () => {
  assertEquals(haversineKm(NEAR_A.lat!, NEAR_A.lng!, FAR.lat!, FAR.lng!) > MAX_HOP_KM, true);
  assertEquals(withinHop(NEAR_A, FAR), false);
});

Deno.test('withinHop: EXCLUDES (false) when prev has null coords (DATA-03 fail-loud)', () => {
  const nullCoord = makePlace({ id: 'nc', lat: null, lng: null });
  assertEquals(withinHop(nullCoord, NEAR_B), false);
});

Deno.test('withinHop: EXCLUDES (false) when candidate has null coords (DATA-03 fail-loud)', () => {
  const nullCoord = makePlace({ id: 'nc', lat: null, lng: null });
  assertEquals(withinHop(NEAR_A, nullCoord), false);
});

Deno.test('withinHop: true when prev is undefined (first stop)', () => {
  assertEquals(withinHop(undefined, NEAR_A), true);
});

// ─── post-validate + repair: a far stop is swapped for the nearest in-slot ──

// Slot 1 is a distinct type (restaurant) with exactly ONE candidate, so the
// anchor is deterministic. Slot 2 (cafe) has a FAR high-score place and a NEAR
// low-score place — the repair must reject FAR and swap in NEAR.
const TWO_SLOT_TEMPLATE: Template = {
  id: 't2',
  name: 'two stops',
  duration_min: 120,
  suitable_for: ['date'],
  vibe: [],
  slots: [
    { types: ['restaurant'], duration_min: 60 },
    { types: ['cafe'], duration_min: 60 },
  ],
  geographic_rule: null,
  energy_curve: null,
};

Deno.test('buildItineraryFromTemplate: repairs a far second stop with a nearer in-slot candidate', () => {
  const anchor = makePlace({ id: 'anchor', type: 'restaurant', lat: 49.8880, lng: -119.4960, quality_score: 100, feedback_score: 0 });
  const farHigh = makePlace({ id: 'far-high', type: 'cafe', lat: 49.9400, lng: -119.4000, quality_score: 50, feedback_score: 0 });
  const nearLow = makePlace({ id: 'near-low', type: 'cafe', lat: 49.8895, lng: -119.4945, quality_score: 1, feedback_score: 0 });

  const it = buildItineraryFromTemplate(
    TWO_SLOT_TEMPLATE,
    [anchor, farHigh, nearLow],
    BASE_INPUTS,
    '10:00',
    new Set(),
    {},
  );
  assertEquals(it !== null, true);
  assertEquals(it!.stops.length, 2);
  assertEquals(it!.stops[0].place_id, 'anchor');
  // Far high-score pick must be repaired down to the near candidate.
  assertEquals(it!.stops[1].place_id, 'near-low');
  // And the assembled plan must pass the hop-gate end-to-end.
  for (let i = 1; i < it!.stops.length; i++) {
    const a = it!.stops[i - 1];
    const b = it!.stops[i];
    assertEquals(haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) <= MAX_HOP_KM, true);
  }
});

// ─── same-experience adjacency penalty (selection time) ──────────────────
// A candidate whose experience group matches the previous pick (cafe→bakery,
// brewery→cocktail_bar) is penalized in scorePlace so a close-scoring
// different-group candidate wins the slot. It is a PENALTY, not a ban: a pool
// with only same-group candidates must still assemble.

Deno.test('categoryGroupForType: cafe-like, drink-like, food groups; outdoors ungrouped', () => {
  assertEquals(categoryGroupForType('cafe'), 'sweet');
  assertEquals(categoryGroupForType('bakery'), 'sweet');
  assertEquals(categoryGroupForType('dessert'), 'sweet');
  assertEquals(categoryGroupForType('ice_cream'), 'sweet');
  assertEquals(categoryGroupForType('brewery'), 'drink');
  assertEquals(categoryGroupForType('cocktail_bar'), 'drink');
  assertEquals(categoryGroupForType('winery'), 'drink');
  assertEquals(categoryGroupForType('restaurant'), 'food');
  assertEquals(categoryGroupForType('park'), 'other');
  assertEquals(categoryGroupForType(null), 'other');
});

// Slot 2 admits both a bakery (same 'sweet' group as the slot-1 cafe) and a
// brewery. The bakery out-scores the brewery on raw quality (+4), but the -8
// same-group adjacency penalty flips the order so the brewery wins. Math.random
// is pinned to 0 so the stochastic top-K picker deterministically takes the
// top-scored candidate.
const CAFE_THEN_ANY_TEMPLATE: Template = {
  id: 't3',
  name: 'cafe then second stop',
  duration_min: 120,
  suitable_for: ['date'],
  vibe: [],
  slots: [
    { types: ['cafe'], duration_min: 60 },
    { types: ['bakery', 'brewery'], duration_min: 60 },
  ],
  geographic_rule: null,
  energy_curve: null,
};

Deno.test('buildItineraryFromTemplate: same-group runner-up loses slot 2 to a close-scoring different-group candidate', () => {
  const realRandom = Math.random;
  Math.random = () => 0; // pickFromTop → always the top-scored candidate
  try {
    const cafe = makePlace({ id: 'cafe', type: 'cafe', lat: 49.8880, lng: -119.4960, quality_score: 10, feedback_score: 0 });
    // Bakery beats brewery by +4 raw — within the -8 adjacency penalty.
    const bakery = makePlace({ id: 'bakery', type: 'bakery', lat: 49.8885, lng: -119.4955, quality_score: 10, feedback_score: 0 });
    const brewery = makePlace({ id: 'brewery', type: 'brewery', lat: 49.8885, lng: -119.4955, quality_score: 6, feedback_score: 0 });

    const it = buildItineraryFromTemplate(
      CAFE_THEN_ANY_TEMPLATE,
      [cafe, bakery, brewery],
      BASE_INPUTS,
      '10:00',
      new Set(),
      {},
    );
    assertEquals(it !== null, true);
    assertEquals(it!.stops[0].place_id, 'cafe');
    // Without the adjacency penalty the bakery (raw 10 vs 6) would win.
    assertEquals(it!.stops[1].place_id, 'brewery');
  } finally {
    Math.random = realRandom;
  }
});

// The 'sweet' group now has a HARD one-per-plan cap (date-flow rule 2), so the
// penalty-not-ban property is asserted on the 'drink' group instead — a
// cocktail bar followed by an only-option brewery must still assemble.
const DRINK_THEN_DRINK_TEMPLATE: Template = {
  id: 't4',
  name: 'drink then drink',
  duration_min: 120,
  suitable_for: ['date'],
  vibe: [],
  slots: [
    { types: ['cocktail_bar'], duration_min: 60 },
    { types: ['brewery'], duration_min: 60 },
  ],
  geographic_rule: null,
  energy_curve: null,
};

Deno.test('buildItineraryFromTemplate: pool with ONLY same-group candidates still assembles (penalty, not ban)', () => {
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const bar = makePlace({ id: 'bar', type: 'cocktail_bar', lat: 49.8880, lng: -119.4960, quality_score: 10, feedback_score: 0 });
    const brewery = makePlace({ id: 'brewery', type: 'brewery', lat: 49.8885, lng: -119.4955, quality_score: 10, feedback_score: 0 });

    const it = buildItineraryFromTemplate(
      DRINK_THEN_DRINK_TEMPLATE,
      [bar, brewery],
      BASE_INPUTS,
      '10:00',
      new Set(),
      {},
    );
    assertEquals(it !== null, true);
    assertEquals(it!.stops.length, 2);
    assertEquals(it!.stops[1].place_id, 'brewery'); // penalized but still fills the slot
  } finally {
    Math.random = realRandom;
  }
});

// ─── Hard date-flow rules (product, 2026-06-10) ──────────────────────────
// 1. No cafes at/after 17:00 — coffee is a morning/afternoon thing; After5 is
//    an evening product. HARD filter, applies even on the relaxed retry.
// 2. Max one 'sweet' stop per plan — dessert→coffee is the same date twice,
//    regardless of adjacency.

Deno.test('date-flow: cafe is rejected for an evening slot even when open late', () => {
  const lateCafe = makePlace({ id: 'late-cafe', type: 'cafe', opens: '08:00', closes: '22:00' });
  const it = buildItineraryFromTemplate(
    SINGLE_SLOT_TEMPLATE, // slot types: ['cafe']
    [lateCafe],
    BASE_INPUTS,
    '18:00',
    new Set(),
    {},
  );
  assertEquals(it, null); // cafe-only slot at 18:00 is unfillable by design
});

Deno.test('date-flow: evening cafe gate also binds the relaxed (skipHoursFilter) retry', () => {
  const nullHoursCafe = makePlace({ id: 'nh-cafe', type: 'cafe', opens: null, closes: null });
  const it = buildItineraryFromTemplate(
    SINGLE_SLOT_TEMPLATE,
    [nullHoursCafe],
    BASE_INPUTS,
    '18:00',
    new Set(),
    { skipHoursFilter: true },
  );
  assertEquals(it, null);
});

Deno.test('date-flow: dessert is still allowed in the evening (only cafes are time-gated)', () => {
  const dessertTemplate: Template = {
    ...SINGLE_SLOT_TEMPLATE,
    id: 't-dessert',
    slots: [{ types: ['dessert'], duration_min: 60 }],
  };
  const gelato = makePlace({ id: 'gelato', type: 'dessert', opens: '12:00', closes: '22:00' });
  const it = buildItineraryFromTemplate(dessertTemplate, [gelato], BASE_INPUTS, '18:00', new Set(), {});
  assertEquals(it !== null, true);
  assertEquals(it!.stops[0].place_id, 'gelato');
});

Deno.test('date-flow: second sweet stop is hard-rejected even when NOT adjacent', () => {
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const sweetSandwichTemplate: Template = {
      ...SINGLE_SLOT_TEMPLATE,
      id: 't-sweet-sandwich',
      duration_min: 180,
      slots: [
        { types: ['dessert'], duration_min: 60 },
        { types: ['restaurant'], duration_min: 60 },
        { types: ['bakery', 'park'], duration_min: 60 },
      ],
    };
    const gelato = makePlace({ id: 'gelato', type: 'dessert', opens: '12:00', closes: '23:00', lat: 49.8880, lng: -119.4960 });
    const resto = makePlace({ id: 'resto', type: 'restaurant', opens: '12:00', closes: '23:00', lat: 49.8884, lng: -119.4956 });
    // Bakery out-scores the park on raw quality, but the one-sweet cap bans it.
    const bakery = makePlace({ id: 'bakery', type: 'bakery', opens: '08:00', closes: '23:00', quality_score: 50, lat: 49.8888, lng: -119.4952 });
    const park = makePlace({ id: 'park', type: 'park', opens: '06:00', closes: '23:00', quality_score: 1, lat: 49.8888, lng: -119.4952 });

    const it = buildItineraryFromTemplate(
      sweetSandwichTemplate,
      [gelato, resto, bakery, park],
      BASE_INPUTS,
      '18:00',
      new Set(),
      {},
    );
    assertEquals(it !== null, true);
    assertEquals(it!.stops.map((s) => s.place_id), ['gelato', 'resto', 'park']);
  } finally {
    Math.random = realRandom;
  }
});
