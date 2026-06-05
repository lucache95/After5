// DATA-03: unverified_rate — the share of the candidate pool we can't fully
// validate (missing coords OR missing hours). A first-class Phase-9 eval signal
// written to sharedLog per generation. Lives in its own module so it stays a
// pure, cheaply-testable function (pipeline.ts pulls in the Anthropic SDK).

import type { Place } from '../types.ts';

/**
 * Fraction of candidates with null/undefined lat, lng, opens, or closes.
 * A place missing several fields still counts once. Empty pool → 0.
 */
export function computeUnverifiedRate(candidates: Place[]): number {
  if (candidates.length === 0) return 0;
  const unverified = candidates.filter(
    (p) => p.lat == null || p.lng == null || !p.opens || !p.closes,
  ).length;
  return unverified / candidates.length;
}
