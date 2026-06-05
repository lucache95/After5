import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildItineraryFromTemplate, isOpenAt } from './scoring.ts';
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
  const it = buildItineraryFromTemplate(
    SINGLE_SLOT_TEMPLATE,
    [nullHours],
    BASE_INPUTS,
    '18:00',
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
    '18:00',
    new Set(),
    {},
  );
  assertEquals(it !== null, true);
  assertEquals(it!.stops[0].unverified, false);
});
