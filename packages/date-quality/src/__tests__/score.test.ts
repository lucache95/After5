// @after5/date-quality — score unit tests.

import { describe, it, expect } from 'vitest';

import { computeScore, finalScore } from '../score';
import { WEIGHTS, type GateResult, type JudgeScores } from '../types';

const flat = (n: number): JudgeScores => ({
  desirability: n,
  arc: n,
  vibe_coherence: n,
  city_context_fit: n,
  specificity_taste: n,
  hook: n,
});

describe('computeScore', () => {
  it('maps a flat 5/5 to 100 and a flat 1/5 to 20', () => {
    expect(computeScore(flat(5))).toBe(100);
    expect(computeScore(flat(1))).toBe(20);
  });

  it('computes the weighted average × 20 correctly', () => {
    // desirability=5, everything else=3.
    const scores: JudgeScores = {
      desirability: 5,
      arc: 3,
      vibe_coherence: 3,
      city_context_fit: 3,
      specificity_taste: 3,
      hook: 3,
    };
    // weighted avg = 3 + (5-3)*0.3 = 3.6 → ×20 = 72.
    const expected =
      20 *
      (5 * WEIGHTS.desirability +
        3 * WEIGHTS.arc +
        3 * WEIGHTS.vibe_coherence +
        3 * WEIGHTS.city_context_fit +
        3 * WEIGHTS.specificity_taste +
        3 * WEIGHTS.hook);
    expect(computeScore(scores)).toBeCloseTo(72, 10);
    expect(computeScore(scores)).toBeCloseTo(expected, 10);
  });

  it('honors custom weights', () => {
    const allOnHook = {
      desirability: 0,
      arc: 0,
      vibe_coherence: 0,
      city_context_fit: 0,
      specificity_taste: 0,
      hook: 1,
    };
    expect(computeScore(flat(4), allOnHook)).toBe(80);
  });
});

const gate = (
  severity: GateResult['severity'],
  pass: boolean,
): GateResult => ({
  gate: `${severity}-gate`,
  pass,
  severity,
  cap_if_fail: { critical: 40, major: 55, minor: 70 }[severity],
  evidence: [],
});

describe('finalScore', () => {
  it('returns the gradient when no gate failed', () => {
    expect(finalScore(88, [gate('critical', true)])).toBe(88);
  });

  it('caps a high gradient to the failed gate cap (gate-cap beats gradient)', () => {
    // gradient 90 but a critical gate failed → capped to 40.
    expect(finalScore(90, [gate('critical', false)])).toBe(40);
  });

  it('uses the lowest cap when several gates fail', () => {
    expect(
      finalScore(95, [gate('minor', false), gate('critical', false), gate('major', false)]),
    ).toBe(40);
  });

  it('does not raise a low gradient up to the cap', () => {
    // gradient 30, minor cap 70 → stays 30 (min wins).
    expect(finalScore(30, [gate('minor', false)])).toBe(30);
  });

  it('clamps to 0..100', () => {
    expect(finalScore(-5, [])).toBe(0);
    expect(finalScore(150, [])).toBe(100);
  });
});
