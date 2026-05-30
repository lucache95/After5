// @after5/date-quality — test fixture/written-date builders.
// Minimal, explicit factories so each gate test can toggle exactly one thing.

import type {
  Fixture,
  FixtureInputs,
  FixtureStop,
  PlaceFacts,
  WrittenDate,
  WrittenStop,
} from '../types';

let pid = 0;
/** Stable-ish unique place id per call. */
export function nextPlaceId(): string {
  pid += 1;
  return `00000000-0000-4000-8000-${String(pid).padStart(12, '0')}`;
}

export function makeFacts(over: Partial<PlaceFacts> = {}): PlaceFacts {
  return {
    place_id: over.place_id ?? nextPlaceId(),
    name: over.name ?? 'Test Place',
    allowed_claims: over.allowed_claims ?? ['lakeside patio'],
    signature_items: over.signature_items,
    setting_tags: over.setting_tags ?? ['patio'],
    sensory_tags: over.sensory_tags ?? ['lake light'],
    avoid_claims: over.avoid_claims,
  };
}

export function makeStop(over: Partial<FixtureStop> = {}): FixtureStop {
  const place_id = over.place_id ?? over.facts?.place_id ?? nextPlaceId();
  const place_name = over.place_name ?? over.facts?.name ?? 'Test Place';
  return {
    place_id,
    place_name,
    place_type: over.place_type ?? 'restaurant',
    start_time: over.start_time ?? '18:00',
    duration_min: over.duration_min ?? 60,
    estimated_cost_pp: over.estimated_cost_pp ?? 20,
    lat: over.lat,
    lng: over.lng,
    opens: over.opens,
    closes: over.closes,
    vibe_tags: over.vibe_tags,
    pairing_tags: over.pairing_tags,
    quality_score: over.quality_score,
    facts: over.facts ?? makeFacts({ place_id, name: place_name }),
  };
}

export function makeInputs(over: Partial<FixtureInputs> = {}): FixtureInputs {
  return {
    occasion: over.occasion ?? 'date',
    vibe: over.vibe ?? ['romantic'],
    budget_per_person: over.budget_per_person ?? 100,
    duration_min: over.duration_min ?? 120,
    effort: over.effort ?? 'moderate',
    must_includes: over.must_includes,
    location: over.location,
    you_pronouns: over.you_pronouns,
    partner_pronouns: over.partner_pronouns,
    intent: over.intent,
    when: over.when,
    future_date: over.future_date,
    note: over.note,
    time_of_day: over.time_of_day,
  };
}

export function makeFixture(over: Partial<Fixture> = {}): Fixture {
  const stops =
    over.stops ??
    [
      makeStop({ place_type: 'winery', place_name: 'Vineyard A' }),
      makeStop({ place_type: 'restaurant', place_name: 'Bistro B' }),
    ];
  return {
    id: over.id ?? 'test-fixture',
    inputs: over.inputs ?? makeInputs(),
    stops,
    packVoiceNote: over.packVoiceNote,
    writtenSample: over.writtenSample,
  };
}

export function makeWrittenStop(
  over: Partial<WrittenStop> = {},
): WrittenStop {
  return {
    place_id: over.place_id ?? nextPlaceId(),
    place_name: over.place_name ?? 'Test Place',
    what_to_do:
      over.what_to_do ??
      'Start at Test Place, a solid local pick. Take your time before moving on.',
  };
}

/** Build a clean WrittenDate whose stops match a fixture's stops by id/name. */
export function makeWrittenFor(
  fixture: Fixture,
  over: Partial<WrittenDate> = {},
): WrittenDate {
  return {
    template_id: over.template_id ?? fixture.id,
    title: over.title ?? 'A Grounded Local Night',
    hook: over.hook ?? 'A real night out, built for you',
    why_it_works:
      over.why_it_works ??
      'Each stop earns its place. The pacing leaves room to breathe.',
    stops:
      over.stops ??
      fixture.stops.map((s) => ({
        place_id: s.place_id,
        place_name: s.place_name,
        what_to_do: `Head to ${s.place_name} and settle in for a while. A genuinely good local spot.`,
      })),
  };
}
