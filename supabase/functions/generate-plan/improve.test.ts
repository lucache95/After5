// Tests for the improve loop (PLAN-02). All logic under test is PURE — no
// Anthropic SDK, no Supabase — so it runs under
//   deno test improve.test.ts --allow-env --allow-read --no-check --node-modules-dir=auto
// (the canonical command for this function dir, per Plan 09-01 SUMMARY).

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  repickSlot,
  validateCoherence,
  applyKnobsToInputs,
  clampTweakText,
  extractKnobs,
  NL_TWEAK_TOOL,
  MAX_TWEAK_TEXT_LENGTH,
  type ImproveKnobs,
} from './improve.ts';
import type { Place, PlanInputs, ItineraryStop } from './types.ts';

// ─── factories ───────────────────────────────────────────────────────────

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
    closes: '22:00',
    quality_score: 5,
    feedback_score: 1,
    local_insight: null,
    notes: null,
    is_active: true,
    ...overrides,
  };
}

function makeStop(overrides: Partial<ItineraryStop>): ItineraryStop {
  return {
    place_id: 'p1',
    place_name: 'Test Place',
    place_type: 'cafe',
    start_time: '18:00',
    duration_min: 60,
    estimated_cost_pp: 10,
    lat: 49.88,
    lng: -119.49,
    ...overrides,
  };
}

const INPUTS: PlanInputs = {
  occasion: 'date',
  duration_min: 180,
  budget_per_person: 50,
  vibe: ['romantic'],
  must_includes: [],
  drive_tolerance_min: 20,
  max_radius_km: 30,
  location: 'out',
  effort: 'low',
  when: 'tonight',
  time_of_day: 'evening',
};

// ─── repickSlot: re-picks ONLY slot i, holding others fixed ───────────────

Deno.test('repickSlot: returns a DIFFERENT place of the same type, holding others', () => {
  const stops = [
    makeStop({ place_id: 'a', place_type: 'restaurant', lat: 49.880, lng: -119.490 }),
    makeStop({ place_id: 'b', place_type: 'cafe', lat: 49.881, lng: -119.491 }),
  ];
  const candidates = [
    makePlace({ id: 'a', type: 'restaurant', lat: 49.880, lng: -119.490 }),
    makePlace({ id: 'b', type: 'cafe', lat: 49.881, lng: -119.491 }),
    // an alternate cafe near b
    makePlace({ id: 'c', type: 'cafe', name: 'Alt Cafe', lat: 49.881, lng: -119.491, quality_score: 9 }),
  ];
  const res = repickSlot(stops, 1, candidates, INPUTS);
  assert(res.ok, 'expected a re-pick');
  if (res.ok) {
    assertEquals(res.stop.place_id, 'c'); // only 'c' is a non-used cafe
    assertEquals(res.stops[0].place_id, 'a'); // slot 0 untouched
  }
});

Deno.test('repickSlot: no alternate candidate surfaces, does not invent', () => {
  const stops = [makeStop({ place_id: 'a', place_type: 'restaurant' })];
  const candidates = [makePlace({ id: 'a', type: 'restaurant' })];
  const res = repickSlot(stops, 0, candidates, INPUTS);
  assertEquals(res.ok, false);
  if (!res.ok) assertEquals(res.code, 'no_alternative');
});

Deno.test('repickSlot: excludes a far-hop alternate (re-validates proximity)', () => {
  const stops = [
    makeStop({ place_id: 'a', place_type: 'restaurant', lat: 49.880, lng: -119.490 }),
    makeStop({ place_id: 'b', place_type: 'cafe', lat: 49.881, lng: -119.491 }),
  ];
  const candidates = [
    makePlace({ id: 'a', type: 'restaurant', lat: 49.880, lng: -119.490 }),
    makePlace({ id: 'b', type: 'cafe', lat: 49.881, lng: -119.491 }),
    // a far cafe — 8km away from stop a; must be rejected by the hop-gate
    makePlace({ id: 'far', type: 'cafe', name: 'Far Cafe', lat: 49.95, lng: -119.40, quality_score: 99 }),
    // a near alternate cafe — should win even though it scores lower
    makePlace({ id: 'near', type: 'cafe', name: 'Near Cafe', lat: 49.881, lng: -119.491, quality_score: 6 }),
  ];
  const res = repickSlot(stops, 1, candidates, INPUTS);
  assert(res.ok);
  if (res.ok) assertEquals(res.stop.place_id, 'near');
});

// ─── validateCoherence: hop + budget + hours ──────────────────────────────

Deno.test('validateCoherence: clean plan passes', () => {
  const stops = [
    makeStop({ place_id: 'a', lat: 49.880, lng: -119.490, estimated_cost_pp: 20 }),
    makeStop({ place_id: 'b', lat: 49.881, lng: -119.491, estimated_cost_pp: 20, start_time: '19:30' }),
  ];
  const places = new Map<string, Place>([
    ['a', makePlace({ id: 'a', lat: 49.880, lng: -119.490, opens: '17:00', closes: '23:00' })],
    ['b', makePlace({ id: 'b', lat: 49.881, lng: -119.491, opens: '17:00', closes: '23:00' })],
  ]);
  const r = validateCoherence(stops, places, INPUTS);
  assertEquals(r.coherent, true);
  assertEquals(r.issues.length, 0);
});

Deno.test('validateCoherence: surfaces a far hop (does not pass silently)', () => {
  const stops = [
    makeStop({ place_id: 'a', lat: 49.880, lng: -119.490 }),
    makeStop({ place_id: 'b', lat: 49.95, lng: -119.40, start_time: '19:30' }),
  ];
  const places = new Map<string, Place>([
    ['a', makePlace({ id: 'a', lat: 49.880, lng: -119.490 })],
    ['b', makePlace({ id: 'b', lat: 49.95, lng: -119.40 })],
  ]);
  const r = validateCoherence(stops, places, INPUTS);
  assertEquals(r.coherent, false);
  assert(r.issues.some((i) => i.kind === 'proximity'));
});

Deno.test('validateCoherence: surfaces over-budget', () => {
  const stops = [
    makeStop({ place_id: 'a', estimated_cost_pp: 200, lat: 49.880, lng: -119.490 }),
  ];
  const places = new Map<string, Place>([
    ['a', makePlace({ id: 'a', lat: 49.880, lng: -119.490 })],
  ]);
  const r = validateCoherence(stops, places, INPUTS);
  assertEquals(r.coherent, false);
  assert(r.issues.some((i) => i.kind === 'budget'));
});

Deno.test('validateCoherence: surfaces a closed-at-slot stop', () => {
  const stops = [makeStop({ place_id: 'a', start_time: '09:00', lat: 49.880, lng: -119.490 })];
  const places = new Map<string, Place>([
    // opens at 17:00 — closed at the 09:00 slot
    ['a', makePlace({ id: 'a', opens: '17:00', closes: '23:00', lat: 49.880, lng: -119.490 })],
  ]);
  const r = validateCoherence(stops, places, INPUTS);
  assertEquals(r.coherent, false);
  assert(r.issues.some((i) => i.kind === 'hours'));
});

// ─── applyKnobsToInputs: NL-knob mapping ──────────────────────────────────

Deno.test('applyKnobsToInputs: cheaper lowers budget', () => {
  const knobs: ImproveKnobs = { budget_delta: -20, vibe: [], intent: '', time_shift: 'none' };
  const out = applyKnobsToInputs(INPUTS, knobs);
  assertEquals(out.budget_per_person, 30);
});

Deno.test('applyKnobsToInputs: budget never goes negative', () => {
  const knobs: ImproveKnobs = { budget_delta: -999, vibe: [], intent: '', time_shift: 'none' };
  const out = applyKnobsToInputs(INPUTS, knobs);
  assert(out.budget_per_person >= 0);
});

Deno.test('applyKnobsToInputs: more romantic adds vibe + intent', () => {
  const knobs: ImproveKnobs = { budget_delta: 0, vibe: ['romantic'], intent: 'reconnect', time_shift: 'none' };
  const out = applyKnobsToInputs({ ...INPUTS, vibe: ['chill'] }, knobs);
  assert(out.vibe.includes('romantic'));
  assertEquals(out.intent, 'reconnect');
});

Deno.test('applyKnobsToInputs: later shifts time_of_day to evening', () => {
  const knobs: ImproveKnobs = { budget_delta: 0, vibe: [], intent: '', time_shift: 'later' };
  const out = applyKnobsToInputs({ ...INPUTS, time_of_day: 'morning' }, knobs);
  assertEquals(out.time_of_day, 'evening');
});

// ─── clampTweakText: prompt-injection mitigation (T-09-11) ────────────────

Deno.test('clampTweakText: caps length', () => {
  const long = 'x'.repeat(MAX_TWEAK_TEXT_LENGTH + 500);
  assertEquals(clampTweakText(long).length, MAX_TWEAK_TEXT_LENGTH);
});

Deno.test('clampTweakText: trims whitespace', () => {
  assertEquals(clampTweakText('  cheaper  '), 'cheaper');
});

// ─── extractKnobs: tool-use extraction (constrained schema, T-09-11) ──────

Deno.test('extractKnobs: pulls knobs from a tool_use block', () => {
  const resp = {
    content: [
      { type: 'tool_use', input: { budget_delta: -15, vibe: ['romantic'], intent: 'reconnect', time_shift: 'none' } },
    ],
  };
  const k = extractKnobs(resp);
  assertEquals(k.budget_delta, -15);
  assertEquals(k.vibe, ['romantic']);
  assertEquals(k.intent, 'reconnect');
  assertEquals(k.time_shift, 'none');
});

Deno.test('extractKnobs: no tool_use block → safe zero knobs (never executes free text)', () => {
  const resp = { content: [{ type: 'text' }] };
  const k = extractKnobs(resp);
  assertEquals(k.budget_delta, 0);
  assertEquals(k.vibe, []);
  assertEquals(k.intent, '');
  assertEquals(k.time_shift, 'none');
});

Deno.test('extractKnobs: clamps a malicious huge budget_delta to the allowed band', () => {
  const resp = { content: [{ type: 'tool_use', input: { budget_delta: 100000, vibe: [], intent: '', time_shift: 'none' } }] };
  const k = extractKnobs(resp);
  assert(Math.abs(k.budget_delta) <= 200);
});

Deno.test('extractKnobs: drops an out-of-enum intent (constrained, not executed)', () => {
  const resp = { content: [{ type: 'tool_use', input: { budget_delta: 0, vibe: [], intent: 'rm -rf', time_shift: 'none' } }] };
  const k = extractKnobs(resp);
  assertEquals(k.intent, '');
});

Deno.test('NL_TWEAK_TOOL: schema constrains intent + time_shift to enums', () => {
  const props = NL_TWEAK_TOOL.input_schema.properties as Record<string, { enum?: string[] }>;
  assert(Array.isArray(props.intent.enum));
  assert(Array.isArray(props.time_shift.enum));
});
