// packages/business/src/reliability.ts
//
// E17 reliability scoring. A PURE function whose weights the SQL
// `recompute_reliability(uuid)` mirrors 1:1 (see
// supabase/migrations/20260605120000_e17_recompute_reliability.sql). Keep these
// two in lockstep — the SQL is the production path, this is the testable spec.
//
// D-01: a simple weighted % of positive outcomes; showed_up heaviest; on_time +
// cancelled_with_notice contribute; unsafe_or_disrespectful penalizes hard.
// "New" (null) until >= MIN_RATINGS_FOR_ESTABLISHED total dates.
// D-02: a no_show lock feeds the score as a 0 missed date (no enforcement).
import { MIN_RATINGS_FOR_ESTABLISHED } from './eligibility';

// Per-date weights (each rated date is scored 0-100, then averaged).
// A clean attended date (showed_up + on_time, no cancellation) scores 100:
// showed_up is heaviest (0.8), on_time the positive modifier (0.2).
const W_SHOWED_UP = 80;
const W_ON_TIME = 20;
// cancelled_with_notice is a RECOVERY signal, not a bonus: it gives partial
// credit ONLY when the ratee did not show up but cancelled politely (a courteous
// flake beats a silent one). It does not add to an already-attended date.
const W_WITH_NOTICE = 50;
// unsafe_or_disrespectful wipes that date's contribution to 0 (hard penalty,
// floored at 0). A date flagged unsafe never credits the positive components.
const UNSAFE_PENALTY = 100;

/** A single rated date for the ratee (from match_ratings), OR a no_show lock. */
export type ReliabilityDate =
  | {
      showed_up: boolean | null;
      on_time: boolean | null;
      cancelled_with_notice: boolean | null;
      unsafe_or_disrespectful: boolean | null;
      no_show?: false;
    }
  | { no_show: true };

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Score one date 0-100. A no_show date is always 0. */
function scoreDate(d: ReliabilityDate): number {
  if ('no_show' in d && d.no_show) return 0;
  // An attended date scores on showed_up + on_time. A no-show date earns only the
  // courtesy-cancellation recovery credit (if any) — it never gets showed_up credit.
  const base = d.showed_up
    ? W_SHOWED_UP + (d.on_time ? W_ON_TIME : 0)
    : d.cancelled_with_notice
      ? W_WITH_NOTICE
      : 0;
  const penalized = d.unsafe_or_disrespectful ? base - UNSAFE_PENALTY : base;
  return clamp(penalized);
}

/**
 * Compute reliability_score (0-100 integer percent) for a ratee.
 *
 * Input is the ratee's per-date outcomes: each entry is either a rated date
 * (from match_ratings) OR a no_show lock. The rated∩no_show overlap rule
 * (RESEARCH Pitfall 4 / Open Q3): no_show is authoritative — a lock that is
 * no_show counts ONCE as a missed date and is NOT also credited a showed_up
 * rating. Callers MUST place each lock in exactly one bucket.
 *
 * Returns null (the "new here" / badge_is_new state) when the ratee has fewer
 * than MIN_RATINGS_FOR_ESTABLISHED total (rated + no_show) dates.
 */
export function computeReliability(
  dates: ReliabilityDate[],
  threshold: number = MIN_RATINGS_FOR_ESTABLISHED,
): number | null {
  if (dates.length < threshold) return null;
  const total = dates.reduce((sum, d) => sum + scoreDate(d), 0);
  return Math.round(clamp(total / dates.length));
}
