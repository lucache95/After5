// @after5/date-quality — runner + judge integration tests (mock LLMs).

import { describe, it, expect } from 'vitest';

import { judge } from '../judge';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  runEval,
  gradeFixture,
  compareToBaseline,
  loadFixtures,
  buildDryWritten,
  dryGenerateLLM,
  dryJudgeLLM,
  computeUnverifiedRate,
  UNVERIFIED_RATE_THRESHOLD,
  type EvalReport,
} from '../runEval';
import { computeUnverifiedRate as prodComputeUnverifiedRate } from '../../../../supabase/functions/generate-plan/providers/unverified-rate';
import type { InvokeLLM } from '../writingPass';
import { makeFixture, makeStop, makeInputs, makeFacts, makeWrittenFor } from './helpers';

/** A mock judge LLM returning a fixed, valid JSON response. */
function mockJudgeLLM(score = 4): InvokeLLM {
  const body = {
    scores: {
      desirability: score,
      arc: score,
      vibe_coherence: score,
      city_context_fit: score,
      specificity_taste: score,
      hook: score,
    },
    evidence: {
      desirability: 'mock',
      arc: 'mock',
      vibe_coherence: 'mock',
      city_context_fit: 'mock',
      specificity_taste: 'mock',
      hook: 'mock',
    },
  };
  return async () => JSON.stringify(body);
}

describe('judge (mock invokeLLM)', () => {
  it('returns parsed scores + evidence from the mock', async () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx);
    const res = await judge(d, fx, { invokeLLM: mockJudgeLLM(5) });
    expect(res.scores.desirability).toBe(5);
    expect(res.evidence.hook).toBe('mock');
  });

  it('throws on a malformed judge response', async () => {
    const fx = makeFixture();
    const d = makeWrittenFor(fx);
    const bad: InvokeLLM = async () => '{"scores":{"desirability":9}}';
    await expect(judge(d, fx, { invokeLLM: bad })).rejects.toThrow();
  });
});

describe('gradeFixture', () => {
  it('skips the judge when a critical gate fails', async () => {
    // Budget blown → critical gate fails → judge must NOT run.
    const fx = makeFixture({
      inputs: makeInputs({ budget_per_person: 10 }),
      stops: [makeStop({ estimated_cost_pp: 80 }), makeStop({ estimated_cost_pp: 70 })],
    });
    const r = await gradeFixture(fx, {
      dry: true,
      generateLLM: dryGenerateLLM(),
      judgeLLM: dryJudgeLLM(),
    });
    expect(r.judged).toBe(false);
    expect(r.failed_critical_gates).toContain('budget_realism');
    expect(r.final_score).toBeLessThanOrEqual(40);
    expect(r.gradient_score).toBeNull();
  });

  it('runs the judge when no critical gate fails', async () => {
    const fx = makeFixture({
      inputs: makeInputs({ budget_per_person: 100 }),
      stops: [
        makeStop({ place_type: 'winery', place_name: 'Vineyard A', estimated_cost_pp: 30, quality_score: 0.8, start_time: '17:30', duration_min: 60 }),
        makeStop({ place_type: 'restaurant', place_name: 'Bistro B', estimated_cost_pp: 40, quality_score: 0.9, start_time: '19:00', duration_min: 60 }),
      ],
    });
    const r = await gradeFixture(fx, {
      dry: true,
      generateLLM: dryGenerateLLM(),
      judgeLLM: dryJudgeLLM(),
    });
    expect(r.judged).toBe(true);
    expect(r.gradient_score).not.toBeNull();
  });
});

describe('buildDryWritten', () => {
  it('synthesizes grounded copy that names each place', () => {
    const fx = makeFixture();
    const d = buildDryWritten(fx);
    for (const s of d.stops) {
      expect(s.what_to_do).toContain(s.place_name);
    }
  });
  it('prefers a fixture-shipped writtenSample', () => {
    const sample = makeWrittenFor(makeFixture(), { title: 'Pinned Sample' });
    const fx = makeFixture({ writtenSample: sample });
    expect(buildDryWritten(fx).title).toBe('Pinned Sample');
  });
});

describe('runEval (dry mode, deterministic)', () => {
  const fixtures = [
    makeFixture({
      id: 'aaa',
      inputs: makeInputs({ budget_per_person: 100 }),
      stops: [
        makeStop({ place_type: 'winery', place_name: 'Vineyard A', estimated_cost_pp: 30, quality_score: 0.8, start_time: '17:30', duration_min: 60, lat: 49.81, lng: -119.47, opens: '11:00', closes: '21:00' }),
        makeStop({ place_type: 'restaurant', place_name: 'Bistro B', estimated_cost_pp: 40, quality_score: 0.9, start_time: '19:00', duration_min: 60, lat: 49.81, lng: -119.47, opens: '11:30', closes: '22:00' }),
      ],
    }),
    makeFixture({
      id: 'bbb',
      inputs: makeInputs({ budget_per_person: 100 }),
      stops: [
        makeStop({ place_type: 'cafe', place_name: 'Cafe C', estimated_cost_pp: 15, quality_score: 0.7, start_time: '17:30', duration_min: 60, lat: 49.88, lng: -119.49, opens: '08:00', closes: '20:00' }),
        makeStop({ place_type: 'viewpoint', place_name: 'Lookout D', estimated_cost_pp: 0, quality_score: 0.95, pairing_tags: ['sunset_spot'], start_time: '19:30', duration_min: 30, lat: 49.886, lng: -119.49, opens: '06:00', closes: '23:00' }),
      ],
    }),
  ];

  it('produces a stable report sorted by fixture_id', async () => {
    const fixedNow = () => new Date('2026-05-30T00:00:00.000Z');
    const a = await runEval(fixtures, { now: fixedNow });
    const b = await runEval(fixtures, { now: fixedNow });
    expect(a.report.fixtures.map((f) => f.fixture_id)).toEqual(['aaa', 'bbb']);
    expect(a.report).toEqual(b.report); // deterministic
    expect(a.report.mode).toBe('dry');
  });

  it('reports no regressions against an identical baseline', async () => {
    const first = await runEval(fixtures, {});
    const cmp = await runEval(fixtures, { baseline: first.report });
    expect(cmp.passed).toBe(true);
    expect(cmp.regressions).toHaveLength(0);
  });
});

describe('compareToBaseline', () => {
  const base: EvalReport = {
    generated_at: 'x',
    suite: 's',
    mode: 'dry',
    mean_score: 80,
    cities: { a: 0 },
    fixtures: [
      {
        fixture_id: 'a',
        final_score: 80,
        gradient_score: 80,
        judged: true,
        failed_gates: [],
        failed_critical_gates: [],
        unsupported_claim: false,
        banned_copy: false,
        judge_scores: null,
        unverified_rate: 0,
      },
    ],
  };

  it('flags a newly failing critical gate', () => {
    const cur: EvalReport = {
      ...base,
      mean_score: 40,
      fixtures: [
        {
          ...base.fixtures[0]!,
          final_score: 40,
          failed_gates: ['budget_realism'],
          failed_critical_gates: ['budget_realism'],
        },
      ],
    };
    const regs = compareToBaseline(cur, base);
    expect(regs.some((r) => r.kind === 'critical_gate')).toBe(true);
    expect(regs.some((r) => r.kind === 'fixture_drop')).toBe(true);
    expect(regs.some((r) => r.kind === 'mean_drop')).toBe(true);
  });

  it('flags a new unsupported claim and banned copy', () => {
    const cur: EvalReport = {
      ...base,
      fixtures: [
        {
          ...base.fixtures[0]!,
          unsupported_claim: true,
          banned_copy: true,
          failed_gates: ['unsupported_concrete_claim', 'no_banned_words'],
          failed_critical_gates: ['unsupported_concrete_claim', 'no_banned_words'],
        },
      ],
    };
    const regs = compareToBaseline(cur, base);
    expect(regs.some((r) => r.kind === 'unsupported_claim')).toBe(true);
    expect(regs.some((r) => r.kind === 'banned_copy')).toBe(true);
  });

  it('passes when nothing regressed', () => {
    expect(compareToBaseline(base, base)).toHaveLength(0);
  });

  it('does not regress on an improvement', () => {
    const better: EvalReport = { ...base, mean_score: 95, fixtures: [{ ...base.fixtures[0]!, final_score: 95 }] };
    expect(compareToBaseline(better, base)).toHaveLength(0);
  });
});

describe('computeUnverifiedRate (eval/production parity)', () => {
  it('matches the production predicate on a mixed pool', () => {
    const stops = [
      makeStop({ lat: 49.8, lng: -119.4, opens: '11:00', closes: '20:00' }), // full
      makeStop({ lat: null, lng: -119.4, opens: '11:00', closes: '20:00' }), // null lat
      makeStop({ lat: 49.8, lng: 49.8, opens: null, closes: '20:00' }), // null opens
      makeStop({ lat: 49.8, lng: -119.4, opens: '', closes: '20:00' }), // falsy (empty) opens
    ];
    const evalRate = computeUnverifiedRate(stops);
    // Mirror to the production Place shape (lat/lng/opens/closes only).
    const prodRate = prodComputeUnverifiedRate(
      stops.map((s) => ({
        place_id: s.place_id,
        name: s.place_name,
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        opens: s.opens ?? null,
        closes: s.closes ?? null,
      })) as never,
    );
    expect(evalRate).toBe(prodRate);
    expect(evalRate).toBeCloseTo(0.75, 10); // 3 of 4 unverified
  });

  it('counts empty-string hours as unverified (falsy, not strict-null)', () => {
    const stops = [makeStop({ lat: 49.8, lng: -119.4, opens: '', closes: '' })];
    expect(computeUnverifiedRate(stops)).toBe(1);
  });

  it('returns 0 for an empty pool', () => {
    expect(computeUnverifiedRate([])).toBe(0);
  });
});

describe('unverified_rate as a scored signal', () => {
  function fullStop(over = {}) {
    return makeStop({ lat: 49.8, lng: -119.4, opens: '11:00', closes: '22:00', ...over });
  }

  it('a thin cold city (half null-data) exceeds the threshold and FAILS the suite', async () => {
    const thin = makeFixture({
      id: 'coldcity-thin-test',
      stops: [
        fullStop({ start_time: '17:30', place_name: 'A' }),
        makeStop({ start_time: '19:00', place_name: 'B', lat: null, lng: null, opens: null, closes: null }),
        makeStop({ start_time: '20:30', place_name: 'C', lat: null, lng: null, opens: '', closes: '' }),
      ],
    });
    const res = await runEval([thin], {
      baseline: {
        generated_at: 'x',
        suite: 's',
        mode: 'dry',
        mean_score: 80,
        cities: {},
        fixtures: [],
      } as EvalReport,
    });
    const r = res.report.fixtures.find((f) => f.fixture_id === 'coldcity-thin-test')!;
    expect(r.unverified_rate).toBeGreaterThan(UNVERIFIED_RATE_THRESHOLD);
    expect(res.regressions.some((x) => x.kind === 'unverified_rate')).toBe(true);
    expect(res.passed).toBe(false);
  });

  it('a usable cold city (mostly full data) clears the threshold', async () => {
    const usable = makeFixture({
      id: 'coldcity-usable-test',
      stops: [
        fullStop({ start_time: '17:30', place_name: 'A' }),
        fullStop({ start_time: '19:00', place_name: 'B' }),
        makeStop({ start_time: '20:30', place_name: 'C', lat: null, lng: null, opens: '10:00', closes: '21:00' }),
      ],
    });
    const res = await runEval([usable], {
      baseline: {
        generated_at: 'x',
        suite: 's',
        mode: 'dry',
        mean_score: 80,
        cities: {},
        fixtures: [],
      } as EvalReport,
    });
    const r = res.report.fixtures.find((f) => f.fixture_id === 'coldcity-usable-test')!;
    expect(r.unverified_rate).toBeLessThanOrEqual(UNVERIFIED_RATE_THRESHOLD);
    expect(res.regressions.some((x) => x.kind === 'unverified_rate')).toBe(false);
  });

  it('groups unverified_rate per city in the report', async () => {
    const thin = makeFixture({
      id: 'coldcity-thin-test',
      stops: [makeStop({ start_time: '17:30', lat: null, lng: null, opens: null, closes: null })],
    });
    const warm = makeFixture({
      id: 'kelowna-warm-test',
      stops: [fullStop({ start_time: '17:30' })],
    });
    const res = await runEval([thin, warm]);
    const cities = res.report.cities;
    expect(cities.coldcity ?? 0).toBeGreaterThan(cities.kelowna ?? 0);
    expect(cities.kelowna).toBe(0);
  });
});

describe('cold-city golden set (on-disk fixtures)', () => {
  const COLDCITY_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../fixtures/dategen/coldcity-v0',
  );

  it('the thin cold-city fixtures FAIL the suite and the usable one clears', async () => {
    const fixtures = await loadFixtures(COLDCITY_DIR);
    expect(fixtures.length).toBe(3);

    const res = await runEval(fixtures, {
      suite: 'dategen/coldcity-v0',
      baseline: {
        generated_at: 'x',
        suite: 'dategen/coldcity-v0',
        mode: 'dry',
        mean_score: 80,
        cities: {},
        fixtures: [],
      } as EvalReport,
    });

    const byId = new Map(res.report.fixtures.map((f) => [f.fixture_id, f]));
    const thin1 = byId.get('coldcity-thin-01-foursquare-cold')!;
    const thin2 = byId.get('coldcity-thin-02-half-null')!;
    const usable = byId.get('coldcity-usable-01-verified')!;

    // Thin fixtures exceed the threshold and flag an unverified_rate regression.
    expect(thin1.unverified_rate).toBeGreaterThan(UNVERIFIED_RATE_THRESHOLD);
    expect(thin2.unverified_rate).toBeGreaterThan(UNVERIFIED_RATE_THRESHOLD);
    // The thin fixtures do NOT lean on null-skipping gates: they would have read
    // green on travel_pacing / open_at_arrival, yet the suite still fails.
    const thinRegs = res.regressions.filter(
      (r) => r.kind === 'unverified_rate',
    );
    expect(thinRegs.some((r) => r.fixture_id === thin1.fixture_id)).toBe(true);
    expect(thinRegs.some((r) => r.fixture_id === thin2.fixture_id)).toBe(true);

    // The usable cold city clears the threshold — no unverified_rate regression.
    expect(usable.unverified_rate).toBeLessThanOrEqual(UNVERIFIED_RATE_THRESHOLD);
    expect(
      res.regressions.some(
        (r) => r.kind === 'unverified_rate' && r.fixture_id === usable.fixture_id,
      ),
    ).toBe(false);

    // The whole suite fails because of the thin fixtures.
    expect(res.passed).toBe(false);

    // Per-city grouping carries the cold city's elevated rate.
    expect(res.report.cities.coldcity ?? 0).toBeGreaterThan(0);
  });
});

describe('dry-mode fact-bank truthfulness', () => {
  it('never emits a forbidden avoid_claim from the fact-bank', async () => {
    const fx = makeFixture({
      stops: [
        makeStop({ place_name: 'Sandhill Tasting Room', facts: makeFacts({ name: 'Sandhill Tasting Room', allowed_claims: ['indoor tasting'], avoid_claims: ['rooftop patio'] }) }),
        makeStop({ place_type: 'restaurant', place_name: 'Bistro B' }),
      ],
    });
    const r = await gradeFixture(fx, { dry: true, generateLLM: dryGenerateLLM(), judgeLLM: dryJudgeLLM() });
    expect(r.unsupported_claim).toBe(false);
  });
});
