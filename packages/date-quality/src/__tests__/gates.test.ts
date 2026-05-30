// @after5/date-quality — gate unit tests. Each gate: one passing + one failing.

import { describe, it, expect } from 'vitest';

import {
  titleLength,
  titleNoTimeOfDay,
  noBannedWords,
  noEmoji,
  hookLength,
  whyItWorksSentences,
  whatToDoQuality,
  placeNameGrounding,
  unsupportedConcreteClaim,
  categoryVariety,
  adjacentStopContrast,
  exactlyOnePeak,
  budgetRealism,
  userIntentCompliance,
  openAtArrival,
  timeOfDayOrder,
  travelPacing,
  firstDateSafety,
  portfolioDiversity,
  runGates,
  GATES,
} from '../gates';
import { buildFallbackWhatToDo } from '../writingPass';
import {
  makeFixture,
  makeStop,
  makeFacts,
  makeInputs,
  makeWrittenFor,
} from './helpers';

describe('titleLength (gate 1)', () => {
  it('passes a ≤8-word title', () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx, { title: 'One Two Three Four' });
    expect(titleLength(fx, d).pass).toBe(true);
  });
  it('fails a 9-word title', () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx, {
      title: 'One Two Three Four Five Six Seven Eight Nine',
    });
    const r = titleLength(fx, d);
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('titleNoTimeOfDay (gate 2)', () => {
  it('passes a title with no time-of-day word', () => {
    const fx = makeFixture();
    expect(titleNoTimeOfDay(fx, makeWrittenFor(fx, { title: 'Lakeside Wander' })).pass).toBe(true);
  });
  it('fails a title naming the time of day', () => {
    const fx = makeFixture();
    const r = titleNoTimeOfDay(fx, makeWrittenFor(fx, { title: 'A Perfect Evening Out' }));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('major');
  });
});

describe('noBannedWords (gate 3)', () => {
  it('passes clean copy', () => {
    const fx = makeFixture();
    expect(noBannedWords(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails copy containing a banned word', () => {
    const fx = makeFixture();
    const r = noBannedWords(fx, makeWrittenFor(fx, { hook: 'An amazing night you must savor' }));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('noEmoji (gate 4)', () => {
  it('passes emoji-free copy', () => {
    const fx = makeFixture();
    expect(noEmoji(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails copy with an emoji', () => {
    const fx = makeFixture();
    const r = noEmoji(fx, makeWrittenFor(fx, { title: 'Lakeside Wander 🌅' }));
    expect(r.pass).toBe(false);
  });
});

describe('hookLength (gate 5)', () => {
  it('passes a ≤12-word hook', () => {
    const fx = makeFixture();
    expect(hookLength(fx, makeWrittenFor(fx, { hook: 'Short and sweet' })).pass).toBe(true);
  });
  it('fails a 13-word hook', () => {
    const fx = makeFixture();
    const r = hookLength(fx, makeWrittenFor(fx, {
      hook: 'one two three four five six seven eight nine ten eleven twelve thirteen',
    }));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('minor');
  });
});

describe('whyItWorksSentences (gate 6)', () => {
  it('passes ≤3 sentences', () => {
    const fx = makeFixture();
    expect(whyItWorksSentences(fx, makeWrittenFor(fx, { why_it_works: 'One. Two. Three.' })).pass).toBe(true);
  });
  it('fails 4 sentences', () => {
    const fx = makeFixture();
    const r = whyItWorksSentences(fx, makeWrittenFor(fx, { why_it_works: 'A. B. C. D.' }));
    expect(r.pass).toBe(false);
  });
});

describe('whatToDoQuality (gate 7)', () => {
  it('passes grounded, long-enough copy', () => {
    const fx = makeFixture();
    expect(whatToDoQuality(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails when a stop uses the deterministic fallback', () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx);
    const first = d.stops[0]!;
    first.what_to_do = buildFallbackWhatToDo(first.place_name);
    const r = whatToDoQuality(fx, d);
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('placeNameGrounding (gate 8)', () => {
  it('passes when copy names the place', () => {
    const fx = makeFixture();
    expect(placeNameGrounding(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails when copy never names the place', () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx);
    d.stops = d.stops.map((s) => ({ ...s, what_to_do: 'Go to the spot and enjoy yourself thoroughly here.' }));
    const r = placeNameGrounding(fx, d);
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('major');
  });
});

describe('unsupportedConcreteClaim (gate 9)', () => {
  it('passes when no forbidden claim appears', () => {
    const fx = makeFixture({
      stops: [makeStop({ place_name: 'Sandhill Tasting Room', facts: makeFacts({ name: 'Sandhill Tasting Room', avoid_claims: ['rooftop patio'] }) })],
    });
    const d = makeWrittenFor(fx, {
      stops: [{ place_id: fx.stops[0]!.place_id, place_name: 'Sandhill Tasting Room', what_to_do: 'Sandhill Tasting Room pours a careful flight of local wine indoors.' }],
    });
    expect(unsupportedConcreteClaim(fx, d).pass).toBe(true);
  });
  it('fails when copy makes a forbidden claim', () => {
    const fx = makeFixture({
      stops: [makeStop({ place_name: 'Sandhill Tasting Room', facts: makeFacts({ name: 'Sandhill Tasting Room', avoid_claims: ['rooftop patio'] }) })],
    });
    const d = makeWrittenFor(fx, {
      stops: [{ place_id: fx.stops[0]!.place_id, place_name: 'Sandhill Tasting Room', what_to_do: 'Grab a seat on the Sandhill Tasting Room rooftop patio and watch the lake.' }],
    });
    const r = unsupportedConcreteClaim(fx, d);
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('categoryVariety (gate 10)', () => {
  it('passes a varied selection', () => {
    const fx = makeFixture({
      stops: [makeStop({ place_type: 'winery', place_name: 'A' }), makeStop({ place_type: 'restaurant', place_name: 'B' })],
    });
    expect(categoryVariety(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails two adjacent same-category stops', () => {
    const fx = makeFixture({
      stops: [makeStop({ place_type: 'winery', place_name: 'A' }), makeStop({ place_type: 'brewery', place_name: 'B' })],
    });
    const r = categoryVariety(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('adjacentStopContrast (gate 11)', () => {
  it('passes when neighbors contrast', () => {
    const fx = makeFixture({
      stops: [
        makeStop({ place_type: 'winery', place_name: 'A', vibe_tags: ['romantic'] }),
        makeStop({ place_type: 'restaurant', place_name: 'B', vibe_tags: ['lively'] }),
      ],
    });
    expect(adjacentStopContrast(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails a redundant beat (same category + heavy vibe overlap)', () => {
    const fx = makeFixture({
      stops: [
        makeStop({ place_type: 'winery', place_name: 'A', vibe_tags: ['upscale', 'tasting'] }),
        makeStop({ place_type: 'brewery', place_name: 'B', vibe_tags: ['upscale', 'tasting'] }),
      ],
    });
    const r = adjacentStopContrast(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('major');
  });
});

describe('exactlyOnePeak (gate 12)', () => {
  it('passes with a single mid/late peak', () => {
    const fx = makeFixture({
      stops: [
        makeStop({ place_name: 'A', quality_score: 0.7 }),
        makeStop({ place_name: 'B', quality_score: 0.95 }),
      ],
    });
    expect(exactlyOnePeak(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails when the peak is the first stop', () => {
    const fx = makeFixture({
      stops: [
        makeStop({ place_name: 'A', quality_score: 0.95 }),
        makeStop({ place_name: 'B', quality_score: 0.7 }),
      ],
    });
    const r = exactlyOnePeak(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('major');
  });
});

describe('budgetRealism (gate 13)', () => {
  it('passes within budget +10%', () => {
    const fx = makeFixture({
      inputs: makeInputs({ budget_per_person: 100 }),
      stops: [makeStop({ estimated_cost_pp: 40 }), makeStop({ estimated_cost_pp: 60 })],
    });
    expect(budgetRealism(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails when stops blow the budget', () => {
    const fx = makeFixture({
      inputs: makeInputs({ budget_per_person: 30 }),
      stops: [makeStop({ estimated_cost_pp: 85 }), makeStop({ estimated_cost_pp: 65 })],
    });
    const r = budgetRealism(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('userIntentCompliance (gate 14)', () => {
  it('passes when must_includes are satisfied and duration fits', () => {
    const fx = makeFixture({
      inputs: makeInputs({ duration_min: 120, must_includes: ['wine'] }),
      stops: [
        makeStop({ place_type: 'winery', place_name: 'Wine Bar', duration_min: 60 }),
        makeStop({ place_type: 'restaurant', place_name: 'B', duration_min: 60 }),
      ],
    });
    expect(userIntentCompliance(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails an unsatisfied must_include', () => {
    const fx = makeFixture({
      inputs: makeInputs({ duration_min: 120, must_includes: ['karaoke'] }),
      stops: [makeStop({ duration_min: 60 }), makeStop({ duration_min: 60 })],
    });
    const r = userIntentCompliance(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('openAtArrival (gate 15)', () => {
  it('passes when the stop is open at arrival', () => {
    const fx = makeFixture({
      stops: [makeStop({ start_time: '18:00', opens: '11:00', closes: '22:00' })],
    });
    expect(openAtArrival(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails when arriving before open', () => {
    const fx = makeFixture({
      stops: [makeStop({ start_time: '09:00', opens: '11:00', closes: '22:00' })],
    });
    const r = openAtArrival(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('timeOfDayOrder (gate 16)', () => {
  it('passes a sunset spot in the golden-hour window', () => {
    const fx = makeFixture({
      stops: [makeStop({ start_time: '19:00', pairing_tags: ['sunset_spot'] })],
    });
    expect(timeOfDayOrder(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails a midday sunset spot', () => {
    const fx = makeFixture({
      stops: [makeStop({ start_time: '12:00', pairing_tags: ['sunset_spot'] })],
    });
    const r = timeOfDayOrder(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('major');
  });
});

describe('travelPacing (gate 17)', () => {
  it('passes a short hop', () => {
    const fx = makeFixture({
      stops: [
        makeStop({ lat: 49.888, lng: -119.495 }),
        makeStop({ lat: 49.886, lng: -119.49 }),
      ],
    });
    expect(travelPacing(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails an impossible hop', () => {
    const fx = makeFixture({
      stops: [
        makeStop({ lat: 49.888, lng: -119.495 }),
        makeStop({ lat: 49.2, lng: -119.0 }),
      ],
    });
    const r = travelPacing(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
  });
});

describe('firstDateSafety (gate 18)', () => {
  it('passes a conversation-first opener for an impress date', () => {
    const fx = makeFixture({
      inputs: makeInputs({ occasion: 'date', intent: 'impress' }),
      stops: [makeStop({ place_type: 'winery', place_name: 'A' }), makeStop({ place_type: 'restaurant', place_name: 'B' })],
    });
    expect(firstDateSafety(fx, makeWrittenFor(fx)).pass).toBe(true);
  });
  it('fails a movie opener on an impress date', () => {
    const fx = makeFixture({
      inputs: makeInputs({ occasion: 'date', intent: 'impress' }),
      stops: [makeStop({ place_type: 'cinema', place_name: 'The Cinema' }), makeStop({ place_type: 'restaurant', place_name: 'B' })],
    });
    const r = firstDateSafety(fx, makeWrittenFor(fx));
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('major');
  });
});

describe('portfolioDiversity (gate 19)', () => {
  it('passes (vacuously) with a single itinerary', () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx);
    expect(portfolioDiversity(fx, d, [d]).pass).toBe(true);
  });
  it('fails when two itineraries share the same place-set', () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx);
    const r = portfolioDiversity(fx, d, [d, { ...d }]);
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('major');
  });
});

describe('runGates / GATES registry', () => {
  it('runs all 18 single-date gates plus portfolio_diversity (19 results)', () => {
    expect(GATES).toHaveLength(18);
    const fx = makeFixture();
    const results = runGates(fx, makeWrittenFor(fx));
    expect(results).toHaveLength(19);
    expect(results[results.length - 1]!.gate).toBe('portfolio_diversity');
  });
  it('derives cap_if_fail from severity for every result', () => {
    const fx = makeFixture();
    for (const r of runGates(fx, makeWrittenFor(fx))) {
      const expected = { critical: 40, major: 55, minor: 70 }[r.severity];
      expect(r.cap_if_fail).toBe(expected);
    }
  });
});
