// @after5/date-quality — runner + judge integration tests (mock LLMs).

import { describe, it, expect } from 'vitest';

import { judge } from '../judge';
import {
  runEval,
  gradeFixture,
  compareToBaseline,
  buildDryWritten,
  dryGenerateLLM,
  dryJudgeLLM,
  type EvalReport,
} from '../runEval';
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
        makeStop({ place_type: 'winery', place_name: 'Vineyard A', estimated_cost_pp: 30, quality_score: 0.8 }),
        makeStop({ place_type: 'restaurant', place_name: 'Bistro B', estimated_cost_pp: 40, quality_score: 0.9 }),
      ],
    }),
    makeFixture({
      id: 'bbb',
      inputs: makeInputs({ budget_per_person: 100 }),
      stops: [
        makeStop({ place_type: 'cafe', place_name: 'Cafe C', estimated_cost_pp: 15, quality_score: 0.7 }),
        makeStop({ place_type: 'viewpoint', place_name: 'Lookout D', estimated_cost_pp: 0, quality_score: 0.95, pairing_tags: ['sunset_spot'], start_time: '19:30' }),
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
