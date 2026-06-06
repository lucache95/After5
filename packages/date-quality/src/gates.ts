// @after5/date-quality — deterministic gates.
//
// Each gate is a PURE function (fixture, writtenDate) => GateResult that
// inspects the writing-pass output (and the fixture's frozen selection +
// fact-bank) and reports pass/fail plus human-readable evidence. A failed gate
// caps the overall score at SEVERITY_CAP[severity] (see score.ts/finalScore);
// the lowest cap wins.
//
// Gates read ONLY the fixture (FixtureStop / PlaceFacts) and the WrittenDate —
// never a live DB. Truthfulness reads the per-place fact-bank (PlaceFacts),
// since `allowed_claims` / `signature_items` / `avoid_claims` are fixture-only
// metadata, not real columns.
//
// Several gates that depend on energy/intimacy/role columns the production
// `places` table does NOT have are APPROXIMATED from quality_score, vibe_tags,
// pairing_tags, and ordinal position — they gate softly and lean on the LLM
// judge for the remainder (documented inline).

import type {
  Fixture,
  FixtureInputs,
  FixtureStop,
  GateResult,
  GateSeverity,
  PlaceFacts,
  WrittenDate,
} from './types';
import { SEVERITY_CAP } from './types';
import { buildFallbackWhatToDo } from './writingPass';

// ─────────────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────────────

/** Build a GateResult, deriving cap_if_fail from severity. */
function result(
  gate: string,
  severity: GateSeverity,
  pass: boolean,
  evidence: string[] = [],
): GateResult {
  return {
    gate,
    pass,
    severity,
    cap_if_fail: SEVERITY_CAP[severity],
    evidence: pass ? [] : evidence,
  };
}

/** Count whitespace-delimited words in a string. */
function wordCount(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Split prose into sentences on terminal punctuation. */
function sentenceCount(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/[.!?]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0).length;
}

/** All copy fields on a WrittenDate, paired with a field label. */
function copyFields(date: WrittenDate): Array<{ field: string; text: string }> {
  const fields: Array<{ field: string; text: string }> = [
    { field: 'title', text: date.title },
    { field: 'hook', text: date.hook },
    { field: 'why_it_works', text: date.why_it_works },
  ];
  for (const stop of date.stops) {
    fields.push({
      field: `stop[${stop.place_id}].what_to_do`,
      text: stop.what_to_do,
    });
  }
  return fields;
}

/** Lowercase + strip punctuation to bare word tokens. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Common words that don't count as a "significant" place-name token. */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'of',
  'at',
  'on',
  'in',
  'bar',
  'cafe',
  'café',
  'restaurant',
  'house',
  'co',
  'company',
  'club',
  'room',
]);

// ─────────────────────────────────────────────────────────────────────────
// Banned-word / emoji vocabularies.
// ─────────────────────────────────────────────────────────────────────────

/** Single banned tokens (matched as whole words, case-insensitive). */
const BANNED_WORDS = [
  'perfect',
  'amazing',
  'unforgettable',
  'magical',
  'indulge',
  'savor',
  'savour',
];

/** Banned multi-word phrases (matched as substrings, case-insensitive). */
const BANNED_PHRASES = ['this experience', 'embark on a journey'];

/** Time-of-day tokens banned in titles. */
const TIME_OF_DAY_WORDS = [
  'morning',
  'afternoon',
  'evening',
  'night',
  'tonight',
];

const EMOJI_RE = /\p{Extended_Pictographic}/u;

// ─────────────────────────────────────────────────────────────────────────
// Category map (§3) — derived from place_type. No `experience_category` column.
// ─────────────────────────────────────────────────────────────────────────

type ExperienceCategory =
  | 'drinking'
  | 'food'
  | 'sweet'
  | 'outdoor'
  | 'culture'
  | 'activity'
  | 'other';

/** Map a coarse place_type to an experience category for adjacency checks. */
function categoryOf(placeType: string): ExperienceCategory {
  const t = placeType.toLowerCase();
  if (/(bar|pub|brewery|winery|taproom|cocktail|wine|distillery|speakeasy)/.test(t)) {
    return 'drinking';
  }
  if (/(dessert|ice.?cream|bakery|patisserie|gelato|chocolate|sweet)/.test(t)) {
    return 'sweet';
  }
  if (/(restaurant|diner|bistro|eatery|food|cafe|café|brunch|ramen|pizza|taco|grill)/.test(t)) {
    return 'food';
  }
  if (/(park|garden|beach|viewpoint|lookout|trail|hike|waterfront|rooftop|patio|outdoor)/.test(t)) {
    return 'outdoor';
  }
  if (/(museum|gallery|theatre|theater|cinema|movie|concert|show|exhibit|culture)/.test(t)) {
    return 'culture';
  }
  if (/(arcade|bowling|mini.?golf|karaoke|climb|skate|class|workshop|escape|activity|game)/.test(t)) {
    return 'activity';
  }
  return 'other';
}

/** True for a sit-down meal type (used by the "no two sit-down meals" rule). */
function isSitDownMeal(placeType: string): boolean {
  const t = placeType.toLowerCase();
  return /(restaurant|diner|bistro|eatery|brunch|ramen|grill)/.test(t);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 1 — title_length (critical). title ≤ 8 words.
// ─────────────────────────────────────────────────────────────────────────

export function titleLength(_fixture: Fixture, date: WrittenDate): GateResult {
  const n = wordCount(date.title);
  return result('title_length', 'critical', n <= 8, [
    `title is ${n} words (max 8): "${date.title}"`,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 2 — title_no_time_of_day (major).
// ─────────────────────────────────────────────────────────────────────────

export function titleNoTimeOfDay(
  _fixture: Fixture,
  date: WrittenDate,
): GateResult {
  const tokens = new Set(tokenize(date.title));
  const hits = TIME_OF_DAY_WORDS.filter((w) => tokens.has(w));
  return result('title_no_time_of_day', 'major', hits.length === 0, [
    `title names time of day (${hits.join(', ')}): "${date.title}"`,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 3 — no_banned_words (critical). Across ALL copy.
// ─────────────────────────────────────────────────────────────────────────

export function noBannedWords(
  _fixture: Fixture,
  date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  for (const { field, text } of copyFields(date)) {
    const tokens = new Set(tokenize(text));
    for (const w of BANNED_WORDS) {
      if (tokens.has(w)) evidence.push(`${field}: banned word "${w}"`);
    }
    const lower = text.toLowerCase();
    for (const p of BANNED_PHRASES) {
      if (lower.includes(p)) evidence.push(`${field}: banned phrase "${p}"`);
    }
  }
  return result('no_banned_words', 'critical', evidence.length === 0, evidence);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 4 — no_emoji (critical). Across ALL copy.
// ─────────────────────────────────────────────────────────────────────────

export function noEmoji(_fixture: Fixture, date: WrittenDate): GateResult {
  const evidence: string[] = [];
  for (const { field, text } of copyFields(date)) {
    if (EMOJI_RE.test(text)) evidence.push(`${field} contains emoji`);
  }
  return result('no_emoji', 'critical', evidence.length === 0, evidence);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 5 — hook_length (minor). hook ≤ 12 words.
// ─────────────────────────────────────────────────────────────────────────

export function hookLength(_fixture: Fixture, date: WrittenDate): GateResult {
  const n = wordCount(date.hook);
  return result('hook_length', 'minor', n <= 12, [
    `hook is ${n} words (max 12): "${date.hook}"`,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 6 — why_it_works_sentences (minor). ≤ 3 sentences.
// ─────────────────────────────────────────────────────────────────────────

export function whyItWorksSentences(
  _fixture: Fixture,
  date: WrittenDate,
): GateResult {
  const n = sentenceCount(date.why_it_works);
  return result('why_it_works_sentences', 'minor', n <= 3, [
    `why_it_works has ${n} sentences (max 3)`,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 7 — what_to_do_quality (critical).
// Every stop's what_to_do present, ≥ 20 chars, not the deterministic fallback.
// ─────────────────────────────────────────────────────────────────────────

const WHAT_TO_DO_MIN_LENGTH = 20;

export function whatToDoQuality(
  _fixture: Fixture,
  date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  for (const stop of date.stops) {
    const w = stop.what_to_do?.trim() ?? '';
    if (!w) {
      evidence.push(`stop[${stop.place_id}]: what_to_do missing`);
      continue;
    }
    if (w.length < WHAT_TO_DO_MIN_LENGTH) {
      evidence.push(
        `stop[${stop.place_id}]: what_to_do too short (${w.length} chars)`,
      );
    }
    if (w === buildFallbackWhatToDo(stop.place_name)) {
      evidence.push(`stop[${stop.place_id}]: used deterministic fallback copy`);
    }
  }
  return result(
    'what_to_do_quality',
    'critical',
    evidence.length === 0,
    evidence,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 8 — place_name_grounding (major).
// Every stop's what_to_do names its place (significant token overlap).
// ─────────────────────────────────────────────────────────────────────────

/** Significant tokens of a place name (drops stop-words + 1-char tokens). */
function significantNameTokens(name: string): string[] {
  return tokenize(name).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function placeNameGrounding(
  _fixture: Fixture,
  date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  for (const stop of date.stops) {
    const nameTokens = significantNameTokens(stop.place_name);
    if (nameTokens.length === 0) continue; // name is all stop-words; skip.
    const copyTokens = new Set(tokenize(stop.what_to_do));
    const grounded = nameTokens.some((t) => copyTokens.has(t));
    if (!grounded) {
      evidence.push(
        `stop[${stop.place_id}]: what_to_do does not name "${stop.place_name}"`,
      );
    }
  }
  return result(
    'place_name_grounding',
    'major',
    evidence.length === 0,
    evidence,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 9 — unsupported_concrete_claim / truthfulness (critical).
// Validates concrete claims in copy against the per-place fact-bank.
//   - any avoid_claims phrase appearing in copy is a hard failure.
//   - any signature_items not authored but a same-category invented item is
//     flagged conservatively (we cannot enumerate every dish, so we only fire
//     on avoid_claims + a fact-bank-vs-copy contradiction we can detect).
// Reads PlaceFacts (fixture-only), never real columns.
// ─────────────────────────────────────────────────────────────────────────

/** Index a fixture's fact-bank by place_id. */
function factsByPlaceId(fixture: Fixture): Map<string, PlaceFacts> {
  const m = new Map<string, PlaceFacts>();
  for (const stop of fixture.stops) m.set(stop.place_id, stop.facts);
  return m;
}

export function unsupportedConcreteClaim(
  fixture: Fixture,
  date: WrittenDate,
): GateResult {
  const facts = factsByPlaceId(fixture);
  const evidence: string[] = [];

  // Copy that is about a specific stop is checked against that stop's facts.
  for (const stop of date.stops) {
    const f = facts.get(stop.place_id);
    if (!f) continue;
    const lower = stop.what_to_do.toLowerCase();
    for (const claim of f.avoid_claims ?? []) {
      if (lower.includes(claim.toLowerCase())) {
        evidence.push(
          `stop[${stop.place_id}]: forbidden claim "${claim}" appears in what_to_do`,
        );
      }
    }
  }

  // Hook + why_it_works are date-level: a forbidden claim from ANY stop here is
  // still a truthfulness failure since the copy implies it about the date.
  const dateLevel = `${date.hook}\n${date.why_it_works}`.toLowerCase();
  for (const stop of fixture.stops) {
    for (const claim of stop.facts.avoid_claims ?? []) {
      if (dateLevel.includes(claim.toLowerCase())) {
        evidence.push(
          `hook/why_it_works: forbidden claim "${claim}" (place ${stop.place_id})`,
        );
      }
    }
  }

  return result(
    'unsupported_concrete_claim',
    'critical',
    evidence.length === 0,
    evidence,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 10 — category_variety (critical).
// No two adjacent stops share an experience category; no two sit-down meals.
// Reads the FROZEN fixture selection (place_type), not the written copy.
// ─────────────────────────────────────────────────────────────────────────

export function categoryVariety(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  const stops = fixture.stops;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    if (!prev || !cur) continue;
    const cp = categoryOf(prev.place_type);
    const cc = categoryOf(cur.place_type);
    if (cp !== 'other' && cp === cc) {
      evidence.push(
        `stops ${i - 1}/${i} share category "${cp}" (${prev.place_name} → ${cur.place_name})`,
      );
    }
  }
  // No two sit-down meals anywhere in the itinerary.
  const sitDown = stops.filter((s) => isSitDownMeal(s.place_type));
  if (sitDown.length > 1) {
    evidence.push(
      `itinerary has ${sitDown.length} sit-down meals: ${sitDown
        .map((s) => s.place_name)
        .join(', ')}`,
    );
  }
  return result('category_variety', 'critical', evidence.length === 0, evidence);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 11 — adjacent_stop_contrast (major, APPROXIMATE).
// Flags neighbors that are too similar in vibe (same dominant vibe tag) with
// the same category — a redundant emotional beat. No energy/intimacy columns
// exist, so this is a soft heuristic; the judge catches the remainder.
// ─────────────────────────────────────────────────────────────────────────

/** Overlap count between two tag arrays. */
function tagOverlap(a?: string[], b?: string[]): string[] {
  if (!a || !b) return [];
  const setB = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => setB.has(x.toLowerCase()));
}

export function adjacentStopContrast(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  const stops = fixture.stops;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    if (!prev || !cur) continue;
    const sameCategory =
      categoryOf(prev.place_type) === categoryOf(cur.place_type) &&
      categoryOf(prev.place_type) !== 'other';
    const sharedVibes = tagOverlap(prev.vibe_tags, cur.vibe_tags);
    // Redundant beat = same category AND heavy vibe overlap (≥2 shared tags).
    if (sameCategory && sharedVibes.length >= 2) {
      evidence.push(
        `stops ${i - 1}/${i} are a redundant beat (shared vibes: ${sharedVibes.join(', ')})`,
      );
    }
  }
  return result(
    'adjacent_stop_contrast',
    'major',
    evidence.length === 0,
    evidence,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 12 — exactly_one_peak (major, APPROXIMATE).
// Exactly one identifiable peak; not at stop 1; not zero peaks. Peak ≈ highest
// quality_score or an anchor pairing_tag (date_anchor / sunset_spot), in a
// mid-to-late position. No `role` column exists → inferred.
// ─────────────────────────────────────────────────────────────────────────

const ANCHOR_TAGS = new Set(['date_anchor', 'sunset_spot', 'showstopper', 'peak']);

/** Indices (0-based) of stops that read as a "peak". */
function peakIndices(stops: FixtureStop[]): number[] {
  // Anchor-tagged stops are explicit peaks.
  const anchored = stops
    .map((s, i) => ({ i, s }))
    .filter(({ s }) =>
      (s.pairing_tags ?? []).some((t) => ANCHOR_TAGS.has(t.toLowerCase())),
    )
    .map(({ i }) => i);
  if (anchored.length > 0) return anchored;

  // Otherwise the single highest quality_score is the peak (if scores exist).
  const scored = stops
    .map((s, i) => ({ i, q: s.quality_score }))
    .filter((x): x is { i: number; q: number } => typeof x.q === 'number');
  if (scored.length === 0) return [];
  const max = Math.max(...scored.map((x) => x.q));
  return scored.filter((x) => x.q === max).map((x) => x.i);
}

export function exactlyOnePeak(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const stops = fixture.stops;
  const peaks = peakIndices(stops);
  const evidence: string[] = [];

  if (peaks.length === 0) {
    // No signal to identify a peak — approximate gate stays soft: pass.
    return result('exactly_one_peak', 'major', true);
  }
  if (peaks.length > 1) {
    evidence.push(
      `found ${peaks.length} peak stops (indices ${peaks.join(', ')}); expected exactly one`,
    );
  }
  if (peaks.length === 1 && peaks[0] === 0 && stops.length > 1) {
    evidence.push('peak is the first stop; the arc should build to it');
  }
  return result(
    'exactly_one_peak',
    'major',
    evidence.length === 0,
    evidence,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 13 — budget_realism (critical).
// total estimated cost pp ≤ budget_per_person × 1.10.
// ─────────────────────────────────────────────────────────────────────────

const BUDGET_TOLERANCE = 1.1;

export function budgetRealism(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const total = fixture.stops.reduce((sum, s) => sum + s.estimated_cost_pp, 0);
  const budget = fixture.inputs.budget_per_person;
  const ceiling = budget * BUDGET_TOLERANCE;
  const pass = total <= ceiling;
  return result('budget_realism', 'critical', pass, [
    `total $${total.toFixed(0)}/pp exceeds budget $${budget}/pp +10% ($${ceiling.toFixed(0)})`,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 14 — user_intent_compliance (critical).
// Honors must_includes, requested duration (±tolerance), stop-count cap.
// ─────────────────────────────────────────────────────────────────────────

const DURATION_TOLERANCE_MIN = 45;
const MAX_STOPS = 3;

/** True if any stop's name/type/facts reference the must-include term. */
function fixtureMentions(stops: FixtureStop[], term: string): boolean {
  const t = term.toLowerCase();
  return stops.some((s) => {
    const hay = [
      s.place_name,
      s.place_type,
      ...(s.vibe_tags ?? []),
      ...(s.pairing_tags ?? []),
      ...s.facts.allowed_claims,
      ...(s.facts.signature_items ?? []),
      ...s.facts.setting_tags,
      ...s.facts.sensory_tags,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(t);
  });
}

export function userIntentCompliance(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const { inputs, stops } = fixture;
  const evidence: string[] = [];

  // must_includes — each requested term must be satisfied by some stop.
  for (const term of inputs.must_includes ?? []) {
    if (term.trim() && !fixtureMentions(stops, term)) {
      evidence.push(`must_include "${term}" not satisfied by any stop`);
    }
  }

  // duration — sum of stop durations within tolerance of requested total.
  const totalDuration = stops.reduce((sum, s) => sum + s.duration_min, 0);
  if (Math.abs(totalDuration - inputs.duration_min) > DURATION_TOLERANCE_MIN) {
    evidence.push(
      `total duration ${totalDuration} min off requested ${inputs.duration_min} min (±${DURATION_TOLERANCE_MIN})`,
    );
  }

  // stop-count cap.
  if (stops.length > MAX_STOPS) {
    evidence.push(`itinerary has ${stops.length} stops (max ${MAX_STOPS})`);
  }
  if (stops.length === 0) {
    evidence.push('itinerary has no stops');
  }

  return result(
    'user_intent_compliance',
    'critical',
    evidence.length === 0,
    evidence,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Time helpers for logistics gates 15 / 16.
// ─────────────────────────────────────────────────────────────────────────

/** Parse "HH:MM" 24h → minutes since midnight, or null if unparseable. */
function parseTime(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 15 — open_at_arrival (critical).
// Each stop is open at its start_time (opens ≤ start_time < closes). Handles
// past-midnight closes (closes < opens). Skips stops missing hours.
// ─────────────────────────────────────────────────────────────────────────

export function openAtArrival(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  for (const stop of fixture.stops) {
    const start = parseTime(stop.start_time);
    const opens = parseTime(stop.opens);
    const closes = parseTime(stop.closes);
    if (start === null || opens === null || closes === null) continue; // no data
    let open: boolean;
    if (closes > opens) {
      open = start >= opens && start < closes;
    } else {
      // Wraps past midnight (e.g. opens 17:00, closes 02:00).
      open = start >= opens || start < closes;
    }
    if (!open) {
      evidence.push(
        `${stop.place_name} arrives ${stop.start_time} but is open ${stop.opens}–${stop.closes}`,
      );
    }
  }
  return result('open_at_arrival', 'critical', evidence.length === 0, evidence);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 16 — time_of_day_order (major).
// A sunset/viewpoint stop lands in the golden-hour window; no sunset spot at
// midday. Heuristic window: 16:30–20:30. Stops without a sunset pairing_tag
// are ignored.
// ─────────────────────────────────────────────────────────────────────────

const SUNSET_WINDOW_START = 16 * 60 + 30; // 16:30
const SUNSET_WINDOW_END = 20 * 60 + 30; // 20:30
const SUNSET_TAGS = new Set(['sunset_spot', 'golden_hour', 'sunset']);

export function timeOfDayOrder(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  for (const stop of fixture.stops) {
    const isSunset = (stop.pairing_tags ?? []).some((t) =>
      SUNSET_TAGS.has(t.toLowerCase()),
    );
    if (!isSunset) continue;
    const start = parseTime(stop.start_time);
    if (start === null) continue;
    if (start < SUNSET_WINDOW_START || start > SUNSET_WINDOW_END) {
      evidence.push(
        `${stop.place_name} is a sunset spot but starts at ${stop.start_time} (window 16:30–20:30)`,
      );
    }
  }
  return result('time_of_day_order', 'major', evidence.length === 0, evidence);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 17 — travel_pacing (critical).
// Drive between adjacent stops ≤ tolerance; no impossible hops. Uses haversine
// from lat/lng when present, with a coarse speed estimate. Skips pairs missing
// coordinates.
// ─────────────────────────────────────────────────────────────────────────

const MAX_DRIVE_MIN = 25;
const AVG_KMH = 30; // dense-city average incl. parking, conservative.

/** Haversine distance in km between two coordinates. */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function travelPacing(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  const stops = fixture.stops;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    if (!prev || !cur) continue;
    if (
      prev.lat == null ||
      prev.lng == null ||
      cur.lat == null ||
      cur.lng == null
    ) {
      continue; // no coordinates → skip pair.
    }
    const km = haversineKm(prev.lat, prev.lng, cur.lat, cur.lng);
    const driveMin = (km / AVG_KMH) * 60;
    if (driveMin > MAX_DRIVE_MIN) {
      evidence.push(
        `${prev.place_name} → ${cur.place_name} ≈ ${km.toFixed(1)} km (~${driveMin.toFixed(0)} min, max ${MAX_DRIVE_MIN})`,
      );
    }
  }
  return result('travel_pacing', 'critical', evidence.length === 0, evidence);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate — schedule_monotonic (critical).
// Stop start times must strictly increase AND a stop must not begin before the
// previous stop's end + the estimated drive between them:
//   start_time[i] + duration_min[i] + drive(i→i+1) ≤ start_time[i+1].
// Catches time-travel (decreasing starts) and overlap (booking a stop before
// the prior one could plausibly have finished). Reuses parseTime + the same
// haversine→AVG_KMH drive estimate travel_pacing uses. Skips a pair only when a
// start_time is unparseable (consistent with the package skip-on-missing
// convention); when both times are present it never skips. The drive term is
// added only when both stops carry coordinates — without coords it degrades to
// a pure end-before-next-start check, still catching overlap and time-travel.
// ─────────────────────────────────────────────────────────────────────────

export function scheduleMonotonic(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const evidence: string[] = [];
  const stops = fixture.stops;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    if (!prev || !cur) continue;
    const prevStart = parseTime(prev.start_time);
    const curStart = parseTime(cur.start_time);
    if (prevStart === null || curStart === null) continue; // unparseable → skip pair.

    // Time-travel: a later stop starts at or before the earlier one.
    if (curStart <= prevStart) {
      evidence.push(
        `${cur.place_name} starts ${cur.start_time} at/before ${prev.place_name} (${prev.start_time}) — schedule not strictly increasing`,
      );
      continue;
    }

    // Overlap: the next stop begins before the previous one ends + travel.
    let driveMin = 0;
    if (
      prev.lat != null &&
      prev.lng != null &&
      cur.lat != null &&
      cur.lng != null
    ) {
      const km = haversineKm(prev.lat, prev.lng, cur.lat, cur.lng);
      driveMin = (km / AVG_KMH) * 60;
    }
    const prevEnd = prevStart + (prev.duration_min ?? 0) + driveMin;
    if (curStart < prevEnd) {
      evidence.push(
        `${cur.place_name} starts ${cur.start_time} but ${prev.place_name} runs until ~${minutesToHHMM(prevEnd)} (incl. ~${driveMin.toFixed(0)} min drive)`,
      );
    }
  }
  return result(
    'schedule_monotonic',
    'critical',
    evidence.length === 0,
    evidence,
  );
}

/** Format minutes-since-midnight back to "HH:MM" for human-readable evidence. */
function minutesToHHMM(mins: number): string {
  const total = Math.round(mins);
  const h = Math.floor(total / 60) % 24;
  const m = ((total % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 18 — first_date_safety (major, CONTEXT MODIFIER).
// Only active for early/impress contexts. Stop 1 must not be a movie/loud-club/
// high-formality dinner; stop 1 should be lower-pressure. Relaxes for
// reconnect/established contexts (gate passes vacuously).
// ─────────────────────────────────────────────────────────────────────────

/** True when the date context is an early / first-date / impress context. */
function isEarlyContext(inputs: FixtureInputs): boolean {
  if (inputs.occasion !== 'date') return false;
  if (inputs.intent === 'reconnect') return false; // established
  return inputs.intent === 'impress' || inputs.intent === 'try_something_new';
}

/** Types that are poor conversation-first openers for a first date. */
function isPoorOpener(placeType: string): boolean {
  const t = placeType.toLowerCase();
  return /(cinema|movie|theater|theatre|nightclub|club|concert)/.test(t);
}

export function firstDateSafety(
  fixture: Fixture,
  _date: WrittenDate,
): GateResult {
  const { inputs, stops } = fixture;
  if (!isEarlyContext(inputs)) {
    return result('first_date_safety', 'major', true); // modifier inactive
  }
  const evidence: string[] = [];
  const first = stops[0];
  if (first && isPoorOpener(first.place_type)) {
    evidence.push(
      `first stop ${first.place_name} (${first.place_type}) is a poor conversation-first opener for an early date`,
    );
  }
  return result('first_date_safety', 'major', evidence.length === 0, evidence);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 19 — portfolio_diversity (major, PORTFOLIO).
// Across the 3 returned itineraries, they must be meaningfully distinct:
// different anchor/peak place and a different category mix. Takes the full
// portfolio. With <2 itineraries the gate passes vacuously (single-fixture
// wrappers can't violate it).
// ─────────────────────────────────────────────────────────────────────────

/** A signature of an itinerary for diversity comparison. */
function itinerarySignature(date: WrittenDate): string {
  return date.stops
    .map((s) => s.place_id)
    .sort()
    .join('|');
}

export function portfolioDiversity(
  _fixture: Fixture,
  _date: WrittenDate,
  portfolio?: WrittenDate[],
): GateResult {
  const set = portfolio ?? [];
  if (set.length < 2) {
    return result('portfolio_diversity', 'major', true);
  }
  const signatures = set.map(itinerarySignature);
  const evidence: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    if (sig === undefined) continue;
    if (seen.has(sig)) {
      evidence.push(
        `itinerary ${i} (${set[i]?.title ?? '?'}) duplicates an earlier place-set`,
      );
    }
    seen.add(sig);
  }
  return result(
    'portfolio_diversity',
    'major',
    evidence.length === 0,
    evidence,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gate registry + runner.
// ─────────────────────────────────────────────────────────────────────────

/** Signature shared by all single-date gates. */
export type Gate = (fixture: Fixture, date: WrittenDate) => GateResult;

/** Ordered list of all single-date gates (cheapest → costliest). */
export const GATES: readonly Gate[] = [
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
  scheduleMonotonic,
  firstDateSafety,
];

/**
 * Run every deterministic gate against one written date for a fixture, plus the
 * portfolio-diversity gate over the optional 3-itinerary set. Returns a
 * GateResult[] in registry order, with portfolio_diversity last. Pure.
 */
export function runGates(
  fixture: Fixture,
  date: WrittenDate,
  portfolio?: WrittenDate[],
): GateResult[] {
  const results = GATES.map((gate) => gate(fixture, date));
  results.push(portfolioDiversity(fixture, date, portfolio));
  return results;
}
