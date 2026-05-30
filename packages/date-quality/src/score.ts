// @after5/date-quality — pure scoring. No I/O, no network.
//
// Two stages:
//   1. computeScore: judge dimensions (1..5) → weighted average → 0..100 base.
//   2. finalScore:   apply deterministic gate caps to the base score.

import type { GateResult, JudgeScores, JudgeWeights } from './types';
import { WEIGHTS } from './types';

/**
 * Gradient (taste) score from the judge's per-dimension 1..5 ratings.
 * Returns 0..100: weighted average of the dimensions, scaled ×20 (so a flat
 * 5/5 across all dimensions = 100, a flat 1/5 = 20). Weights must sum to 1.
 */
export function computeScore(
  judgeScores: JudgeScores,
  weights: JudgeWeights = WEIGHTS,
): number {
  let weighted = 0;
  for (const key of Object.keys(weights) as Array<keyof JudgeScores>) {
    weighted += judgeScores[key] * weights[key];
  }
  return 20 * weighted;
}

/**
 * Final overall score: the gradient score capped by any failed gates.
 * Each failed gate caps the score at its `cap_if_fail`; the lowest cap wins.
 * Passing gates impose no cap. Result is clamped to 0..100.
 */
export function finalScore(
  gradientScore: number,
  failedGates: GateResult[],
): number {
  const caps = failedGates
    .filter((g) => !g.pass)
    .map((g) => g.cap_if_fail);
  const cap = caps.length > 0 ? Math.min(...caps) : 100;
  return Math.max(0, Math.min(gradientScore, cap, 100));
}
