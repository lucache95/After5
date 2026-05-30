# Date-Quality Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline, automated eval that scores the `generate-plan` writing pass against the After5 Good Date Standard, so prompt/model changes can be compared and regressions caught (and later consumed by auto-optimization).

**Architecture:** Score the **writing pass in isolation** — feed frozen `(inputs + selected itineraries + places)` into the existing `writeItineraries()`, then grade the output with (1) pure deterministic **rule checks** (gates) and (2) an **LLM-as-judge** rubric (gradient). A pure `computeScore()` combines them via gates × gradient. A runner executes all cases, aggregates, and diffs against a baseline. Everything is Deno-local under the function (the edge functions don't import workspace packages).

**Tech Stack:** Deno, `npm:@anthropic-ai/sdk@^0.40.0`, `https://deno.land/std@0.208.0/assert/mod.ts` for tests. Source of truth for the rubric: `docs/superpowers/specs/2026-05-26-good-date-standard.md`.

---

## File Map

All new files under `supabase/functions/generate-plan/eval/`:
- `types.ts` — `RuleResult`, `JudgeScores`, `DateScore`, `EvalCase` interfaces.
- `rules.ts` — pure deterministic rule checks (the gates + soft rules) → `checkRules()`.
- `rules_test.ts` — `deno test` for `rules.ts`.
- `score.ts` — pure `computeScore(rules, judge)` (gates × gradient).
- `score_test.ts` — `deno test` for `score.ts`.
- `judge.ts` — `buildJudgePrompt()` + `parseJudgeResponse()` (pure) + `judgeItinerary()` (Anthropic call).
- `judge_test.ts` — `deno test` for the pure judge helpers.
- `scorer.ts` — `scoreItinerary()` reusable contract (rules + judge + computeScore).
- `cases.json` — frozen fixtures (seed: 1 fully-specified case).
- `run.ts` — runner: load cases → `writeItineraries` → `scoreItinerary` → aggregate → baseline diff → write report.
- `README.md` — how to run.

Reused (not modified): `../prompt.ts` (`writeItineraries`, `WriteResult`), `../types.ts` (`Itinerary`, `ItineraryStop`, `PlanInputs`, `Place`).

---

## Task 1: Eval shared types

**Files:**
- Create: `supabase/functions/generate-plan/eval/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// supabase/functions/generate-plan/eval/types.ts
// Shared types for the date-quality eval. See
// docs/superpowers/specs/2026-05-26-good-date-standard.md for the rubric.
import type { Itinerary, PlanInputs, Place } from '../types.ts';

/** Result of one deterministic rule check. */
export interface RuleResult {
  id: string;          // e.g. 'title_length'
  pass: boolean;
  gate: boolean;       // true → a failure caps the overall score (hard constraint)
  detail?: string;     // human-readable reason on failure
}

/** LLM-as-judge rubric scores (each 1–5). */
export interface JudgeScores {
  desirability: number;
  arc: number;
  vibe_coherence: number;
  taste: number;
  scroll_stopping: number;
  notes: string;
}

/** Combined score for one itinerary. */
export interface DateScore {
  overall: number;        // 0–100
  rulePassRate: number;   // 0–1
  rules: RuleResult[];
  judge: JudgeScores | null;  // null when the judge was skipped/failed
  flags: string[];        // ids of failed gates
  gated: boolean;         // true if any gate failed (score capped)
}

/** A frozen eval input: selected places + itineraries, copy to be (re)written. */
export interface EvalCase {
  id: string;
  city: string;        // e.g. "Kelowna, BC" or "Brooklyn, NY" — locale for the judge
  inputs: PlanInputs;
  itineraries: Itinerary[];
  places: Place[];
}
```

- [ ] **Step 2: Type-check the file**

Run: `deno check supabase/functions/generate-plan/eval/types.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-plan/eval/types.ts
git commit -m "feat(eval): shared types for date-quality eval"
```

---

## Task 2: Deterministic rule checks (the gates)

Implements the 🔧 items from the Good Date Standard: copy hard-rules + category-variety + budget realism + ends-on-high.

**Files:**
- Create: `supabase/functions/generate-plan/eval/rules.ts`
- Test: `supabase/functions/generate-plan/eval/rules_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/generate-plan/eval/rules_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { checkRules } from './rules.ts';
import type { Itinerary, PlanInputs, Place } from '../types.ts';

const inputs: PlanInputs = {
  occasion: 'date', duration_min: 180, budget_per_person: 50,
  vibe: ['romantic'], must_includes: [], drive_tolerance_min: 20,
  max_radius_km: 30, location: 'out', effort: 'low',
};

function place(id: string, name: string, type: string): Place {
  return {
    id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), address: null,
    neighborhood: 'Downtown', drive_cluster: 'core', type, vibe_tags: ['romantic'],
    pairing_tags: [], effort: 'low', time_of_day: ['evening'], weather_dependent: false,
    seasonality: ['year_round'], typical_duration_min: 60, price_tier: '$$',
    typical_per_person: 20, reservation_required: false, reservation_url: null,
    photo_url: null, lat: null, lng: null, opens: null, closes: null,
    quality_score: 7, feedback_score: 0, local_insight: null, notes: null,
  };
}

function stop(place_id: string, place_name: string, place_type: string, what_to_do: string) {
  return {
    place_id, place_name, place_type, start_time: '18:00',
    duration_min: 60, estimated_cost_pp: 20, what_to_do,
  };
}

function clean(): { it: Itinerary; places: Map<string, Place> } {
  const places = new Map<string, Place>([
    ['p1', place('p1', 'Sandrine', 'cafe')],
    ['p2', place('p2', 'The Bench', 'viewpoint')],
    ['p3', place('p3', 'Frankie We Salute You', 'restaurant')],
  ]);
  const it: Itinerary = {
    template_id: 't1', template_name: 'Classic', title: 'Coffee then the bluffs',
    hook: 'Caffeine, a climb, then dinner with a view',
    why_it_works: 'You warm up over coffee. The climb gives you something to do. Dinner lands the evening.',
    stops: [
      stop('p1', 'Sandrine', 'cafe', 'At Sandrine grab a flat white and the window counter for the morning light.'),
      stop('p2', 'The Bench', 'viewpoint', 'Walk up to The Bench for the lookout over the lake before dinner.'),
      stop('p3', 'Frankie We Salute You', 'restaurant', 'At Frankie We Salute You split the burrata and the window two-top.'),
    ],
    total_cost_pp: 45, total_duration_min: 180, vibe: ['romantic'],
  };
  return { it, places };
}

Deno.test('clean itinerary passes all gates', () => {
  const { it, places } = clean();
  const rules = checkRules(inputs, it, places, new Set());
  const failedGates = rules.filter((r) => r.gate && !r.pass);
  assertEquals(failedGates, []);
});

Deno.test('title over 8 words fails the title_length gate', () => {
  const { it, places } = clean();
  it.title = 'A truly very long and overly wordy title that rambles';
  const rules = checkRules(inputs, it, places, new Set());
  const r = rules.find((x) => x.id === 'title_length')!;
  assertEquals(r.pass, false);
  assertEquals(r.gate, true);
});

Deno.test('banned word fails the no_banned_words gate', () => {
  const { it, places } = clean();
  it.why_it_works = 'This is a perfect evening you will love.';
  const rules = checkRules(inputs, it, places, new Set());
  const r = rules.find((x) => x.id === 'no_banned_words')!;
  assertEquals(r.pass, false);
});

Deno.test('two adjacent drinking stops fail category_variety', () => {
  const { it, places } = clean();
  places.set('p2', place('p2', 'Bar Sci', 'cocktail_bar'));
  places.set('p1', place('p1', 'BNA Brewing', 'brewery'));
  it.stops[0] = stop('p1', 'BNA Brewing', 'brewery', 'Start with a flight at BNA Brewing in the brick room.');
  it.stops[1] = stop('p2', 'Bar Sci', 'cocktail_bar', 'Walk to Bar Sci for a mezcal sour at the counter.');
  const rules = checkRules(inputs, it, places, new Set());
  const r = rules.find((x) => x.id === 'category_variety')!;
  assertEquals(r.pass, false);
  assertEquals(r.gate, true);
});

Deno.test('over-budget itinerary fails budget_realism', () => {
  const { it, places } = clean();
  it.total_cost_pp = 200; // budget is 50
  const rules = checkRules(inputs, it, places, new Set());
  const r = rules.find((x) => x.id === 'budget_realism')!;
  assertEquals(r.pass, false);
});

Deno.test('fallback what_to_do fails what_to_do_quality gate', () => {
  const { it, places } = clean();
  const rules = checkRules(inputs, it, places, new Set(['p1']));
  const r = rules.find((x) => x.id === 'what_to_do_quality')!;
  assertEquals(r.pass, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/generate-plan/eval/rules_test.ts`
Expected: FAIL — `checkRules` not found.

- [ ] **Step 3: Implement `rules.ts`**

```typescript
// supabase/functions/generate-plan/eval/rules.ts
// Pure deterministic rule checks — the GATES of the Good Date Standard.
// No I/O. See docs/superpowers/specs/2026-05-26-good-date-standard.md §2–§3.
import type { Itinerary, PlanInputs, Place } from '../types.ts';
import type { RuleResult } from './types.ts';

const BANNED_WORDS = [
  'perfect', 'amazing', 'unforgettable', 'magical',
  'embark on a journey', 'indulge in', 'this experience', 'savor',
];
const TIME_OF_DAY_WORDS = ['morning', 'afternoon', 'evening', 'night', 'tonight'];

// Experience categories — adjacency of the same category is forbidden (§3).
const CATEGORY: Record<string, string> = {
  brewery: 'drinking', cocktail_bar: 'drinking', winery: 'drinking', pub: 'drinking', bar: 'drinking',
  restaurant: 'food',
  cafe: 'sweet', dessert: 'sweet', ice_cream: 'sweet', bakery: 'sweet',
  hike: 'outdoor', viewpoint: 'outdoor', beach: 'outdoor', park: 'outdoor',
  garden: 'outdoor', sunset_spot: 'outdoor', walk: 'outdoor',
  gallery: 'culture', market: 'culture', shop: 'culture',
  activity: 'activity',
};
// Low-energy "errand-y" categories that should not be the final (peak) stop.
const LOW_ENERGY_END = new Set(['culture']);

const WHAT_TO_DO_MIN_LENGTH = 20;
const EMOJI = /\p{Extended_Pictographic}/u;

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
function sentences(s: string): number {
  return s.split(/[.!?]+/).map((x) => x.trim()).filter(Boolean).length;
}
function containsBanned(s: string): string | null {
  const lower = s.toLowerCase();
  for (const w of BANNED_WORDS) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return w;
  }
  return null;
}
function nameGrounded(whatToDo: string, placeName: string): boolean {
  const sig = placeName.split(/\s+/).filter((w) => w.length >= 4)[0] ?? placeName;
  return whatToDo.toLowerCase().includes(sig.toLowerCase());
}

/**
 * Run all deterministic checks against one itinerary.
 * @param fallbackPlaceIds place_ids whose what_to_do came from the deterministic
 *   fallback (from WriteResult.fallback_stops) — these are automatic gate failures.
 */
export function checkRules(
  inputs: PlanInputs,
  it: Itinerary,
  placesById: Map<string, Place>,
  fallbackPlaceIds: Set<string>,
): RuleResult[] {
  const allCopy = [it.title, it.hook, it.why_it_works, ...it.stops.map((s) => s.what_to_do ?? '')].join(' ');
  const rules: RuleResult[] = [];

  // --- Copy hard-rules (gates) ---
  rules.push({
    id: 'title_length', gate: true, pass: words(it.title) <= 8,
    detail: `title has ${words(it.title)} words (max 8)`,
  });
  const todWord = TIME_OF_DAY_WORDS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(it.title));
  rules.push({
    id: 'title_no_time_of_day', gate: true, pass: !todWord,
    detail: todWord ? `title contains time-of-day word "${todWord}"` : undefined,
  });
  const banned = containsBanned(allCopy);
  rules.push({
    id: 'no_banned_words', gate: true, pass: !banned,
    detail: banned ? `contains banned word "${banned}"` : undefined,
  });
  rules.push({
    id: 'no_emoji', gate: true, pass: !EMOJI.test(allCopy),
    detail: 'copy contains emoji',
  });
  rules.push({
    id: 'hook_length', gate: true, pass: words(it.hook) <= 12,
    detail: `hook has ${words(it.hook)} words (max 12)`,
  });
  rules.push({
    id: 'why_it_works_sentences', gate: true, pass: sentences(it.why_it_works) <= 3,
    detail: `why_it_works has ${sentences(it.why_it_works)} sentences (max 3)`,
  });

  // --- what_to_do quality (gate): present, long enough, not a fallback ---
  const badStops = it.stops.filter(
    (s) => fallbackPlaceIds.has(s.place_id) ||
      !s.what_to_do || s.what_to_do.length < WHAT_TO_DO_MIN_LENGTH,
  );
  rules.push({
    id: 'what_to_do_quality', gate: true, pass: badStops.length === 0,
    detail: badStops.length ? `${badStops.length} stop(s) empty/short/fallback` : undefined,
  });

  // --- what_to_do grounding (soft rule, not a gate) ---
  const ungrounded = it.stops.filter((s) => !nameGrounded(s.what_to_do ?? '', s.place_name));
  rules.push({
    id: 'what_to_do_grounded', gate: false, pass: ungrounded.length === 0,
    detail: ungrounded.length ? `${ungrounded.length} stop(s) don't name their place` : undefined,
  });

  // --- Category variety (gate): no two adjacent stops in the same category ---
  let varietyOk = true;
  let varietyDetail: string | undefined;
  for (let i = 0; i < it.stops.length - 1; i++) {
    const a = CATEGORY[it.stops[i].place_type] ?? it.stops[i].place_type;
    const b = CATEGORY[it.stops[i + 1].place_type] ?? it.stops[i + 1].place_type;
    if (a === b) {
      varietyOk = false;
      varietyDetail = `stops ${i + 1}&${i + 2} are both "${a}"`;
      break;
    }
  }
  rules.push({ id: 'category_variety', gate: true, pass: varietyOk, detail: varietyDetail });

  // --- Budget realism (gate): total within 10% over budget ---
  rules.push({
    id: 'budget_realism', gate: true,
    pass: it.total_cost_pp <= inputs.budget_per_person * 1.1,
    detail: `total $${it.total_cost_pp} vs budget $${inputs.budget_per_person}`,
  });

  // --- Ends on a high note (soft rule) ---
  const lastType = it.stops[it.stops.length - 1]?.place_type ?? '';
  const lastCat = CATEGORY[lastType] ?? lastType;
  rules.push({
    id: 'ends_on_high', gate: false, pass: !LOW_ENERGY_END.has(lastCat),
    detail: LOW_ENERGY_END.has(lastCat) ? `ends on low-energy "${lastCat}"` : undefined,
  });

  return rules;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/generate-plan/eval/rules_test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-plan/eval/rules.ts supabase/functions/generate-plan/eval/rules_test.ts
git commit -m "feat(eval): deterministic Good Date Standard rule checks"
```

---

## Task 3: Composite score (gates × gradient)

**Files:**
- Create: `supabase/functions/generate-plan/eval/score.ts`
- Test: `supabase/functions/generate-plan/eval/score_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/generate-plan/eval/score_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { computeScore } from './score.ts';
import type { JudgeScores, RuleResult } from './types.ts';

const passingRules: RuleResult[] = [
  { id: 'title_length', gate: true, pass: true },
  { id: 'category_variety', gate: true, pass: true },
  { id: 'ends_on_high', gate: false, pass: true },
];
const topJudge: JudgeScores = {
  desirability: 5, arc: 5, vibe_coherence: 5, taste: 5, scroll_stopping: 5, notes: '',
};

Deno.test('all 5s with passing gates scores 100', () => {
  const s = computeScore(passingRules, topJudge);
  assertEquals(s.overall, 100);
  assertEquals(s.gated, false);
});

Deno.test('a failed gate caps overall at 40', () => {
  const rules: RuleResult[] = [
    { id: 'title_length', gate: true, pass: false, detail: 'too long' },
    { id: 'category_variety', gate: true, pass: true },
  ];
  const s = computeScore(rules, topJudge);
  assert(s.overall <= 40);
  assertEquals(s.gated, true);
  assertEquals(s.flags, ['title_length']);
});

Deno.test('gradient weights desirability highest', () => {
  const lowDes: JudgeScores = { ...topJudge, desirability: 1 };
  const lowTaste: JudgeScores = { ...topJudge, taste: 1 };
  // desirability weight 0.35 > taste weight 0.10, so dropping desirability hurts more.
  assert(computeScore(passingRules, lowDes).overall < computeScore(passingRules, lowTaste).overall);
});

Deno.test('no judge falls back to rule pass rate', () => {
  const s = computeScore(passingRules, null);
  // 3/3 soft+gate rules pass → 100
  assertEquals(s.overall, 100);
  assertEquals(s.judge, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/generate-plan/eval/score_test.ts`
Expected: FAIL — `computeScore` not found.

- [ ] **Step 3: Implement `score.ts`**

```typescript
// supabase/functions/generate-plan/eval/score.ts
// Pure composite scoring: gates × gradient. See Good Date Standard §2.
import type { DateScore, JudgeScores, RuleResult } from './types.ts';

const WEIGHTS = {
  desirability: 0.35,
  arc: 0.25,
  vibe_coherence: 0.20,
  taste: 0.10,
  scroll_stopping: 0.10,
} as const;

const GATE_CAP = 40; // a failed gate caps the overall score here

/** 1–5 weighted judge dims → 0–100. */
function gradient(j: JudgeScores): number {
  const weighted =
    WEIGHTS.desirability * j.desirability +
    WEIGHTS.arc * j.arc +
    WEIGHTS.vibe_coherence * j.vibe_coherence +
    WEIGHTS.taste * j.taste +
    WEIGHTS.scroll_stopping * j.scroll_stopping; // → 1–5
  return Math.round(weighted * 20); // → 20–100
}

export function computeScore(rules: RuleResult[], judge: JudgeScores | null): DateScore {
  const failedGates = rules.filter((r) => r.gate && !r.pass);
  const gated = failedGates.length > 0;
  const passed = rules.filter((r) => r.pass).length;
  const rulePassRate = rules.length ? passed / rules.length : 1;

  // Gradient comes from the judge; with no judge, fall back to rule pass rate.
  const base = judge ? gradient(judge) : Math.round(rulePassRate * 100);
  const overall = gated ? Math.min(GATE_CAP, base) : base;

  return {
    overall,
    rulePassRate,
    rules,
    judge,
    flags: failedGates.map((r) => r.id),
    gated,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/generate-plan/eval/score_test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-plan/eval/score.ts supabase/functions/generate-plan/eval/score_test.ts
git commit -m "feat(eval): composite gates x gradient scoring"
```

---

## Task 4: LLM-as-judge (rubric)

`buildJudgePrompt` + `parseJudgeResponse` are pure and tested; `judgeItinerary` makes the Anthropic call (not unit-tested).

**Files:**
- Create: `supabase/functions/generate-plan/eval/judge.ts`
- Test: `supabase/functions/generate-plan/eval/judge_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/generate-plan/eval/judge_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildJudgePrompt, parseJudgeResponse } from './judge.ts';
import type { Itinerary, PlanInputs } from '../types.ts';

const inputs: PlanInputs = {
  occasion: 'date', duration_min: 180, budget_per_person: 50, vibe: ['romantic'],
  must_includes: [], drive_tolerance_min: 20, max_radius_km: 30, location: 'out', effort: 'low',
};
const it: Itinerary = {
  template_id: 't1', template_name: 'Classic', title: 'Coffee then the bluffs',
  hook: 'Caffeine, a climb, then dinner', why_it_works: 'Warm up, climb, land it.',
  stops: [{ place_id: 'p1', place_name: 'Sandrine', place_type: 'cafe', start_time: '18:00', duration_min: 60, estimated_cost_pp: 10, what_to_do: 'Flat white at the window.' }],
  total_cost_pp: 40, total_duration_min: 180, vibe: ['romantic'],
};

Deno.test('prompt includes the city, itinerary title and rubric dimensions', () => {
  const p = buildJudgePrompt('Kelowna, BC', inputs, it);
  assert(p.includes('Kelowna, BC'));
  assert(p.includes('Coffee then the bluffs'));
  assert(p.toLowerCase().includes('desirability'));
  assert(p.toLowerCase().includes('arc'));
});

Deno.test('parses a clean judge JSON object', () => {
  const json = '{"desirability":4,"arc":5,"vibe_coherence":4,"taste":3,"scroll_stopping":4,"notes":"solid"}';
  const r = parseJudgeResponse(json)!;
  assertEquals(r.desirability, 4);
  assertEquals(r.notes, 'solid');
});

Deno.test('parses JSON wrapped in markdown fences', () => {
  const json = '```json\n{"desirability":3,"arc":3,"vibe_coherence":3,"taste":3,"scroll_stopping":3,"notes":"x"}\n```';
  const r = parseJudgeResponse(json)!;
  assertEquals(r.arc, 3);
});

Deno.test('returns null on unparseable text', () => {
  assertEquals(parseJudgeResponse('not json at all'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/generate-plan/eval/judge_test.ts`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement `judge.ts`**

```typescript
// supabase/functions/generate-plan/eval/judge.ts
// LLM-as-judge: scores one itinerary against the Good Date Standard gradient
// dimensions (§1). The judge model should be strong (Opus by default).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import type { Itinerary, PlanInputs } from '../types.ts';
import type { JudgeScores } from './types.ts';

const JUDGE_SYSTEM = `You score After5 date plans the way a person with great taste who actually plans thoughtful dates would. Would they be proud to send this to someone they liked?

Score each dimension 1–5 (5 = excellent):
- desirability: is there a clear standout moment, and does this make you want to live this night with someone?
- arc: does it build (easy warm-up → peak → warm ending) rather than peak early or fizzle?
- vibe_coherence: is it one cohesive idea/feeling, or three good places stapled together?
- taste: concrete, sensory, insider/specific — or generic praise a bot could write?
- scroll_stopping: would the title + hook stop your scroll? concrete and intriguing vs vague? (Must honestly reflect the date — penalize clickbait.)

The date is in a specific city (given below). The best dates feel authentic to their city and locally specific — favor the kind of standout moment that genuinely fits THIS place (a lake sunset in Kelowna, a hidden rooftop or speakeasy in a dense city), not generic ideas or moments that feel out of place. Reward local specificity over tourist defaults, and reward dates that feel naturally thoughtful rather than performatively optimized — "humanly desirable" beats "impressively optimized."

Output ONLY a JSON object: {"desirability":N,"arc":N,"vibe_coherence":N,"taste":N,"scroll_stopping":N,"notes":"one short sentence"}. No prose outside the JSON.`;

export function buildJudgePrompt(city: string, inputs: PlanInputs, it: Itinerary): string {
  const stops = it.stops
    .map((s, i) => `  ${i + 1}. ${s.place_name} (${s.place_type}) — ${s.what_to_do ?? ''}`)
    .join('\n');
  return [
    `City: ${city}`,
    `User wanted: occasion=${inputs.occasion}, vibe=${inputs.vibe.join('/')}, budget=$${inputs.budget_per_person}/pp, ~${inputs.duration_min}min, intent=${inputs.intent ?? 'n/a'}.`,
    ``,
    `Date plan to score:`,
    `Title: ${it.title}`,
    `Hook: ${it.hook}`,
    `Why it works: ${it.why_it_works}`,
    `Stops:`,
    stops,
    ``,
    `Return ONLY the JSON object.`,
  ].join('\n');
}

export function parseJudgeResponse(text: string): JudgeScores | null {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    const o = JSON.parse(cleaned);
    const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
    const scores: JudgeScores = {
      desirability: num(o.desirability), arc: num(o.arc),
      vibe_coherence: num(o.vibe_coherence), taste: num(o.taste),
      scroll_stopping: num(o.scroll_stopping), notes: String(o.notes ?? ''),
    };
    const dims = [scores.desirability, scores.arc, scores.vibe_coherence, scores.taste, scores.scroll_stopping];
    if (dims.some((n) => Number.isNaN(n))) return null;
    return scores;
  } catch {
    return null;
  }
}

/** Call the judge model once, retry once on parse failure, return null if it can't. */
export async function judgeItinerary(
  client: Anthropic, model: string, city: string, inputs: PlanInputs, it: Itinerary,
): Promise<JudgeScores | null> {
  const prompt = buildJudgePrompt(city, inputs, it);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model, max_tokens: 512, temperature: 0,
        system: [{ type: 'text', text: JUDGE_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt }],
      });
      const block = res.content.find((b) => b.type === 'text');
      if (block && block.type === 'text') {
        const parsed = parseJudgeResponse(block.text);
        if (parsed) return parsed;
      }
    } catch (err) {
      console.error(`[judge] attempt ${attempt + 1} failed:`, err);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/generate-plan/eval/judge_test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-plan/eval/judge.ts supabase/functions/generate-plan/eval/judge_test.ts
git commit -m "feat(eval): LLM-as-judge rubric scorer"
```

---

## Task 5: `scoreItinerary` — the reusable contract

Combines rules + judge + computeScore. This is the interface the runner (and later the dashboard / an optimizer) consumes.

**Files:**
- Create: `supabase/functions/generate-plan/eval/scorer.ts`

- [ ] **Step 1: Write the file**

```typescript
// supabase/functions/generate-plan/eval/scorer.ts
// Reusable "score one date" contract: deterministic rules + LLM judge → DateScore.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import type { Itinerary, PlanInputs, Place } from '../types.ts';
import type { DateScore } from './types.ts';
import { checkRules } from './rules.ts';
import { judgeItinerary } from './judge.ts';
import { computeScore } from './score.ts';

export async function scoreItinerary(
  client: Anthropic,
  judgeModel: string,
  city: string,
  inputs: PlanInputs,
  it: Itinerary,
  placesById: Map<string, Place>,
  fallbackPlaceIds: Set<string>,
): Promise<DateScore> {
  const rules = checkRules(inputs, it, placesById, fallbackPlaceIds);
  const judge = await judgeItinerary(client, judgeModel, city, inputs, it);
  return computeScore(rules, judge);
}
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/generate-plan/eval/scorer.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-plan/eval/scorer.ts
git commit -m "feat(eval): scoreItinerary reusable contract"
```

---

## Task 6: Seed fixtures (`cases.json`)

One fully-specified case so the runner works end-to-end. Grow the corpus later (see README).

**Files:**
- Create: `supabase/functions/generate-plan/eval/cases.json`

- [ ] **Step 1: Write the seed case**

```json
[
  {
    "id": "romantic-evening-mid-budget",
    "city": "Kelowna, BC",
    "inputs": {
      "occasion": "date", "duration_min": 180, "budget_per_person": 60,
      "vibe": ["romantic"], "must_includes": [], "drive_tolerance_min": 20,
      "max_radius_km": 30, "location": "out", "effort": "low",
      "when": "tonight", "intent": "impress", "time_of_day": "evening"
    },
    "places": [
      { "id": "p1", "name": "Sandrine", "slug": "sandrine", "address": null, "neighborhood": "Downtown", "drive_cluster": "core", "type": "cafe", "vibe_tags": ["chill", "romantic"], "pairing_tags": [], "effort": "low", "time_of_day": ["evening"], "weather_dependent": false, "seasonality": ["year_round"], "typical_duration_min": 45, "price_tier": "$$", "typical_per_person": 12, "reservation_required": false, "reservation_url": null, "photo_url": null, "lat": null, "lng": null, "opens": null, "closes": null, "quality_score": 8, "feedback_score": 0, "local_insight": "The canele is the move; the window counter gets the late light.", "notes": null, "perceived_value": "exceeds_price" },
      { "id": "p2", "name": "Knox Mountain Bluffs", "slug": "knox-mountain", "address": null, "neighborhood": "North End", "drive_cluster": "core", "type": "viewpoint", "vibe_tags": ["adventurous", "romantic"], "pairing_tags": ["sunset_spot"], "effort": "moderate", "time_of_day": ["evening", "sunset"], "weather_dependent": true, "seasonality": ["spring", "summer", "fall"], "typical_duration_min": 60, "price_tier": "$", "typical_per_person": 0, "reservation_required": false, "reservation_url": null, "photo_url": null, "lat": null, "lng": null, "opens": null, "closes": null, "quality_score": 9, "feedback_score": 0, "local_insight": "Pisi Bay lookout catches the whole lake at golden hour.", "notes": null, "perceived_value": "exceeds_price" },
      { "id": "p3", "name": "RauDZ", "slug": "raudz", "address": null, "neighborhood": "Downtown", "drive_cluster": "core", "type": "restaurant", "vibe_tags": ["romantic", "boujee"], "pairing_tags": ["date_anchor"], "effort": "low", "time_of_day": ["evening"], "weather_dependent": false, "seasonality": ["year_round"], "typical_duration_min": 90, "price_tier": "$$$", "typical_per_person": 45, "reservation_required": true, "reservation_url": null, "photo_url": null, "lat": null, "lng": null, "opens": null, "closes": null, "quality_score": 9, "feedback_score": 0, "local_insight": "Sit at the chef's counter and let them feed you.", "notes": null, "perceived_value": "matches" }
    ],
    "itineraries": [
      {
        "template_id": "tmpl-classic",
        "template_name": "Warm-up, view, dinner",
        "title": "", "hook": "", "why_it_works": "",
        "stops": [
          { "place_id": "p1", "place_name": "Sandrine", "place_type": "cafe", "start_time": "17:00", "duration_min": 45, "estimated_cost_pp": 12 },
          { "place_id": "p2", "place_name": "Knox Mountain Bluffs", "place_type": "viewpoint", "start_time": "18:00", "duration_min": 60, "estimated_cost_pp": 0 },
          { "place_id": "p3", "place_name": "RauDZ", "place_type": "restaurant", "start_time": "19:30", "duration_min": 90, "estimated_cost_pp": 45 }
        ],
        "total_cost_pp": 57, "total_duration_min": 195, "vibe": ["romantic"]
      }
    ]
  }
]
```

- [ ] **Step 2: Validate the JSON**

Run: `deno eval "JSON.parse(Deno.readTextFileSync('supabase/functions/generate-plan/eval/cases.json')); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-plan/eval/cases.json
git commit -m "feat(eval): seed eval case (romantic evening)"
```

---

## Task 7: The runner (`run.ts`) + README

Loads cases, runs the real writing pass + scorer, aggregates, diffs against baseline, writes a report. This is the integration tool (makes real Anthropic calls), verified by running it once — not a unit test.

**Files:**
- Create: `supabase/functions/generate-plan/eval/run.ts`
- Create: `supabase/functions/generate-plan/eval/README.md`

- [ ] **Step 1: Implement `run.ts`**

```typescript
// supabase/functions/generate-plan/eval/run.ts
// Offline eval runner. Usage:
//   deno run --allow-env --allow-net --allow-read --allow-write \
//     supabase/functions/generate-plan/eval/run.ts [--update-baseline]
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (writer, default sonnet),
//      JUDGE_MODEL (default opus).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import type { Itinerary, Place } from '../types.ts';
import { writeItineraries } from '../prompt.ts';
import { scoreItinerary } from './scorer.ts';
import type { DateScore, EvalCase } from './types.ts';

const DIR = new URL('.', import.meta.url).pathname;
const updateBaseline = Deno.args.includes('--update-baseline');

const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required');
  Deno.exit(1);
}
const writerModel = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';
const judgeModel = Deno.env.get('JUDGE_MODEL') ?? 'claude-opus-4-7';
const client = new Anthropic({ apiKey });

const cases: EvalCase[] = JSON.parse(await Deno.readTextFile(`${DIR}cases.json`));

// Store the generated copy too, so reports are auditable + pairwise-ready (post-v1).
interface CaseResult { caseId: string; itineraries: Itinerary[]; itineraryScores: DateScore[]; avg: number; }
const results: CaseResult[] = [];

for (const c of cases) {
  const placesById = new Map<string, Place>(c.places.map((p) => [p.id, p]));
  // Re-write copy with the current prompt/model on the frozen selection.
  const written = await writeItineraries(apiKey, writerModel, {
    inputs: c.inputs, itineraries: c.itineraries, placesById,
  });
  const fallbackIds = new Set(written.fallback_stops.map((f) => f.place_id));

  const itineraryScores: DateScore[] = [];
  for (const it of written.itineraries) {
    itineraryScores.push(
      await scoreItinerary(client, judgeModel, c.city, c.inputs, it, placesById, fallbackIds),
    );
  }
  const avg = itineraryScores.reduce((s, x) => s + x.overall, 0) / (itineraryScores.length || 1);
  results.push({ caseId: c.id, itineraries: written.itineraries, itineraryScores, avg });
  console.log(`  ${c.id}: ${avg.toFixed(1)}/100${itineraryScores.some((s) => s.gated) ? '  ⚠ gated' : ''}`);
}

// --- Aggregate ---
const overall = results.reduce((s, r) => s + r.avg, 0) / (results.length || 1);
const allRules = results.flatMap((r) => r.itineraryScores.flatMap((s) => s.rules));
const rulePass = allRules.filter((r) => r.pass).length / (allRules.length || 1);
const judges = results.flatMap((r) => r.itineraryScores.map((s) => s.judge)).filter(Boolean);
const dimAvg = (k: 'desirability' | 'arc' | 'vibe_coherence' | 'taste' | 'scroll_stopping') =>
  judges.length ? (judges.reduce((s, j) => s + (j![k] as number), 0) / judges.length).toFixed(2) : 'n/a';

console.log('\n=== Eval summary ===');
console.log(`Overall: ${overall.toFixed(1)}/100`);
console.log(`Rule pass rate: ${(rulePass * 100).toFixed(0)}%`);
console.log(`Judge — desirability ${dimAvg('desirability')}, arc ${dimAvg('arc')}, vibe ${dimAvg('vibe_coherence')}, taste ${dimAvg('taste')}, scroll ${dimAvg('scroll_stopping')}`);

// --- Baseline diff ---
const baselinePath = `${DIR}baseline.json`;
let baseline: Record<string, number> = {};
try { baseline = JSON.parse(await Deno.readTextFile(baselinePath)); } catch { /* no baseline yet */ }
const current: Record<string, number> = Object.fromEntries(results.map((r) => [r.caseId, r.avg]));
const regressions = results.filter((r) => baseline[r.caseId] !== undefined && r.avg < baseline[r.caseId] - 3);
if (regressions.length) {
  console.log('\n⚠ Regressions vs baseline:');
  for (const r of regressions) console.log(`  ${r.caseId}: ${baseline[r.caseId].toFixed(1)} → ${r.avg.toFixed(1)}`);
} else if (Object.keys(baseline).length) {
  console.log('\nNo regressions vs baseline.');
}

// --- Write report ---
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await Deno.mkdir(`${DIR}runs`, { recursive: true });
await Deno.writeTextFile(`${DIR}runs/${stamp}.json`, JSON.stringify({ overall, rulePass, results }, null, 2));
console.log(`\nReport: eval/runs/${stamp}.json`);

if (updateBaseline) {
  await Deno.writeTextFile(baselinePath, JSON.stringify(current, null, 2));
  console.log('Baseline updated.');
}
```

- [ ] **Step 2: Write the README**

```markdown
# generate-plan eval

Offline date-quality eval. Scores the writing pass against the Good Date Standard
(`docs/superpowers/specs/2026-05-26-good-date-standard.md`).

## Run

```bash
export ANTHROPIC_API_KEY=sk-...
deno run --allow-env --allow-net --allow-read --allow-write \
  supabase/functions/generate-plan/eval/run.ts
# accept the current scores as the regression baseline:
deno run --allow-env --allow-net --allow-read --allow-write \
  supabase/functions/generate-plan/eval/run.ts --update-baseline
```

Env: `ANTHROPIC_MODEL` (writer, default `claude-sonnet-4-6`), `JUDGE_MODEL` (default `claude-opus-4-7`).

## Unit tests (no API key needed)

```bash
deno test supabase/functions/generate-plan/eval/
```

## Growing the corpus

`cases.json` ships with one case. Add cases by pasting real selected itineraries
+ their places (copy fields can be left as `""` — the runner re-writes them).
Each case needs a `"city"` (e.g. `"Kelowna, BC"`, `"Brooklyn, NY"`) — the judge uses it for locale fit. Aim for coverage across **cities**, vibes, budgets, durations, occasions, and intents.

## Calibration

Before trusting the number, hand-rate ~5 dates yourself and confirm the eval ranks
them in the same order. Re-fit the gradient weights in `score.ts` against real
`save_rate` / `feedback` once available.
```

- [ ] **Step 3: Run all unit tests**

Run: `deno test supabase/functions/generate-plan/eval/`
Expected: PASS (rules_test 6, score_test 4, judge_test 4).

- [ ] **Step 4: Run the eval end-to-end once (smoke test)**

Run:
```bash
export ANTHROPIC_API_KEY=<your key>
deno run --allow-env --allow-net --allow-read --allow-write supabase/functions/generate-plan/eval/run.ts --update-baseline
```
Expected: prints the case score, an `=== Eval summary ===` block, writes `eval/runs/<stamp>.json` and `eval/baseline.json`.

- [ ] **Step 5: Ignore run artifacts in git**

Add to `.gitignore`: `supabase/functions/generate-plan/eval/runs/`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-plan/eval/run.ts supabase/functions/generate-plan/eval/README.md supabase/functions/generate-plan/eval/baseline.json .gitignore
git commit -m "feat(eval): offline runner with baseline regression diff"
```

---

## Self-review notes (for the executor)

- **Calibration is mandatory before trust:** the judge number is meaningless until you confirm it ranks hand-rated dates correctly (README "Calibration"). Do this after Task 7.
- **Weights are a prior:** the `WEIGHTS` in `score.ts` come from the Good Date Standard review, not data. Re-fit against `save_rate`/`feedback` later.
- **Deferred (not in this plan, by design):** drive-time / open-hours / time-of-day-order gates (need `start_time` parsing + lat/lng), and venue `energy`/`intimacy` metadata for the richer incompatibility rules (§3) — add only if eval data shows they matter.
- **Cost:** each run = (cases × ~1 writer call) + (cases × itineraries × 1 judge call). With 1 seed case that's tiny; budget-check before scaling the corpus.

## Future evolution (post-v1 — from review, not in scope now)

These are correct future directions; v1 deliberately ships without them.
- **Pairwise / head-to-head judging for regressions** — the highest-value next upgrade. Absolute 1–5 scores drift run-to-run from judge noise; for comparing two prompt versions, judging old-vs-new *per case* is far more stable. v1 already enables this by storing generated copy in each run report. (Later: tournament / Elo across versions.)
- **Inter-dimension correlation check** — desirability / taste / scroll_stopping / coherence likely correlate; once enough runs exist, analyze variance and prune or re-weight collapsed dimensions. Reinforces "weights are a prior."
- **`effort_authenticity` as a scored dimension** — "naturally thoughtful" vs "performatively optimized" is folded into the judge framing for v1; promote it to its own scored dimension only if the 5 collapse and this signal goes missing.
- **Human signal is ground truth; the judge is a proxy** — the end state: real `save_rate` / lock-rate / feedback *override* judge priors and re-fit the weights. The judge is a fast stand-in for human preference, never a replacement. This is the guard against "eval optimized against itself."
