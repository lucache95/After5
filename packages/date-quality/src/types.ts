// @after5/date-quality — shared contract for the offline date-quality eval.
//
// This package grades the GENERATOR's writing-pass output (title / hook /
// why_it_works + per-stop what_to_do) for a frozen set of selected places.
// It is pure, offline, and has zero workspace or network dependencies at the
// type level — fixtures carry their own fact-bank (PlaceFacts) because the
// production `places` table has NO `allowed_claims` / `signature_items` /
// `avoid_claims` columns. Truthfulness gates validate against the fixture
// fact-bank, never against real columns.
//
// Field names on the WrittenDate / WrittenStop shapes mirror the generator's
// REAL output (supabase/functions/generate-plan/types.ts → Itinerary /
// ItineraryStop and prompt.ts → WriteResult) so downstream graders match the
// production contract exactly.

// ─────────────────────────────────────────────────────────────────────────
// Fixture fact-bank — the per-place ground truth a fixture author writes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Authored ground truth for one place in a fixture. Backs the truthfulness /
 * unsupported-concrete-claim gate: any concrete noun, dish, or feature named
 * in the written copy must be present in this fact-bank, and must not appear
 * in `avoid_claims`. These fields do NOT exist as columns on the production
 * `places` table — they are fixture-only metadata authored in cases.json.
 */
export interface PlaceFacts {
  /** UUID — matches WrittenStop.place_id and the frozen selection. */
  place_id: string;
  /** Human-facing place name — used by the place-name-grounding gate. */
  name: string;
  /**
   * Concrete claims that ARE true of this place (e.g. "lakeside patio",
   * "wood-fired oven", "open until midnight"). The writer may reference any
   * of these. Empty array = no concrete claims are licensed.
   */
  allowed_claims: string[];
  /**
   * Named signature items the writer may cite (dishes, drinks, features).
   * A subset of allowed_claims kept separate so graders can reward specific
   * item callouts. Omitted = none authored.
   */
  signature_items?: string[];
  /**
   * Coarse setting descriptors (e.g. "indoor", "patio", "rooftop",
   * "waterfront"). Used to sanity-check setting claims in copy.
   */
  setting_tags: string[];
  /**
   * Sensory descriptors that are true here (e.g. "lake light", "vinyl",
   * "wood smoke"). Licenses sensory-detail callouts.
   */
  sensory_tags: string[];
  /**
   * Claims that are explicitly FALSE / forbidden for this place (e.g. a venue
   * with no patio lists "patio"). A copy match here is a hard truthfulness
   * failure. Omitted = nothing explicitly forbidden.
   */
  avoid_claims?: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Fixture input — the user date inputs + the FROZEN selected places.
// ─────────────────────────────────────────────────────────────────────────

/** User-supplied date inputs the writing pass consumes (subset of PlanInputs). */
export interface FixtureInputs {
  occasion: 'date' | 'solo' | 'friends';
  vibe: string[];
  budget_per_person: number;
  duration_min: number;
  effort: 'low' | 'moderate' | 'high';
  must_includes?: string[];
  location?: 'out' | 'home';
  you_pronouns?: 'she/her' | 'he/him' | 'they/them' | '';
  partner_pronouns?: 'she/her' | 'he/him' | 'they/them' | '';
  intent?: 'impress' | 'chill' | 'reconnect' | 'try_something_new' | '';
  when?: 'tonight' | 'future';
  future_date?: string;
  note?: string;
  time_of_day?: 'morning' | 'evening' | 'all_day';
}

/**
 * One frozen, already-selected stop in a fixture. The place_id is fixed; the
 * writing pass never re-selects. Carries the logistics fields the deferred
 * logistics gates (open-at-arrival, travel/pacing, time-of-day order) read,
 * plus the fact-bank for truthfulness grading.
 */
export interface FixtureStop {
  place_id: string;
  /** Denormalized place name — mirrors ItineraryStop.place_name. */
  place_name: string;
  /** Coarse experience type, e.g. "cocktail_bar", "restaurant", "viewpoint". */
  place_type: string;
  /** "HH:MM" 24h local start time — mirrors ItineraryStop.start_time. */
  start_time: string;
  duration_min: number;
  estimated_cost_pp: number;
  /** Per-place ground truth backing the truthfulness gate. */
  facts: PlaceFacts;
  // Optional logistics columns (REAL on the places table) for deferred gates.
  lat?: number | null;
  lng?: number | null;
  opens?: string | null;
  closes?: string | null;
  vibe_tags?: string[];
  pairing_tags?: string[];
  quality_score?: number;
}

/** A complete eval case: user inputs + the frozen 3-stop (typ.) selection. */
export interface Fixture {
  /** Stable case identifier, e.g. "impress-budget-tight". */
  id: string;
  inputs: FixtureInputs;
  /** Frozen selected stops in sequence order. */
  stops: FixtureStop[];
  /** Optional editorial-pack tone directive passed to the writer. */
  packVoiceNote?: string | null;
  /**
   * Optional pre-written copy a fixture may ship. When present, dry mode grades
   * THIS verbatim instead of synthesizing copy — lets a fixture author pin an
   * exact written sample (e.g. a captured production output) for regression.
   */
  writtenSample?: WrittenDate;
}

// ─────────────────────────────────────────────────────────────────────────
// Written output — what the writing pass produces, graded by the eval.
// Field names mirror the generator's REAL output (Itinerary / ItineraryStop).
// ─────────────────────────────────────────────────────────────────────────

/** Written copy for one stop — mirrors ItineraryStop's copy fields. */
export interface WrittenStop {
  place_id: string;
  place_name: string;
  /** 2-3 sentence prose, mandatory in production output. */
  what_to_do: string;
}

/** Written copy for one date — mirrors the copy fields merged onto Itinerary. */
export interface WrittenDate {
  /** Unchanged from the source itinerary. */
  template_id: string;
  /** ≤ 8 words. */
  title: string;
  /** ≤ 12 words. */
  hook: string;
  /** ≤ 3 sentences. */
  why_it_works: string;
  stops: WrittenStop[];
}

/**
 * The full writing-pass result for a fixture — mirrors WriteResult in
 * supabase/functions/generate-plan/prompt.ts.
 */
export interface WriteResult {
  itineraries: WrittenDate[];
  /** Number of stops that used the deterministic fallback. */
  fallback_count: number;
  /** Stops that fell back to deterministic copy — drives the what_to_do gate. */
  fallback_stops: Array<{ place_id: string; place_name: string }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Deterministic gates.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A failed gate caps the overall score at `cap_if_fail`. Lowest cap wins when
 * several fail. critical = broken/dishonest/unsafe; major = real but
 * salvageable defect; minor = polish below the "proud to send" bar.
 */
export type GateSeverity = 'critical' | 'major' | 'minor';

/** Score cap applied when a gate of the given severity fails. */
export const SEVERITY_CAP: Record<GateSeverity, number> = {
  critical: 40,
  major: 55,
  minor: 70,
};

/** Result of running one deterministic gate against a WrittenDate. */
export interface GateResult {
  /** Stable gate id, e.g. "title_length", "no_banned_words". */
  gate: string;
  /** true = passed (no cap applied). */
  pass: boolean;
  severity: GateSeverity;
  /** The cap this gate imposes on failure — SEVERITY_CAP[severity]. */
  cap_if_fail: number;
  /** Human-readable evidence strings explaining a failure (empty on pass). */
  evidence: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Judge (gradient) scores + weights.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The six judged dimensions, each scored 1..5 by the LLM judge. Maps to the
 * Good-Date-Standard dimensions: desirability (F), arc (A), vibe_coherence
 * (C), city_context_fit (I), specificity_taste (E), hook (D).
 */
export interface JudgeScores {
  /** F — would a real person want to go on this date. */
  desirability: number;
  /** A — emotional arc / pacing across stops. */
  arc: number;
  /** C — internal vibe consistency vs the requested vibe. */
  vibe_coherence: number;
  /** I — fits the city / locale, not generic anywhere-copy. */
  city_context_fit: number;
  /** E — concrete, sensory, specific rather than vague. */
  specificity_taste: number;
  /** D — the hook earns a tap / stops the scroll. */
  hook: number;
}

/** Weight applied to each judged dimension. Must sum to 1.00. */
export type JudgeWeights = Record<keyof JudgeScores, number>;

/**
 * Default gradient weights. PRIOR only — re-fit against save_rate / feedback.
 * Sums to 1.00. Desirability stays top weight; arc + vibe_coherence +
 * city_context_fit (combined 0.50) guard against pretty-but-pointless drift.
 */
export const WEIGHTS: JudgeWeights = {
  desirability: 0.3,
  arc: 0.2,
  vibe_coherence: 0.15,
  city_context_fit: 0.15,
  specificity_taste: 0.15,
  hook: 0.05,
};
