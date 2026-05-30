// @after5/date-quality — LLM-as-judge gradient scorer.
//
// Scores ONE WrittenDate against its Fixture across the six JudgeScores
// dimensions (desirability / arc / vibe_coherence / city_context_fit /
// specificity_taste / hook), each 1..5, and REQUIRES one evidence string per
// dimension. The LLM call is INJECTED (same InvokeLLM seam as writingPass) so
// unit tests mock it deterministically — this module never imports an SDK.
//
// Contract notes:
//   - The judge is only CALLED after the deterministic gates pass; the runner
//     enforces that ordering. judge.ts just scores; it knows nothing about
//     gates or caps.
//   - The judge's knowledge is BOUNDED: it may only reason from the fixture
//     metadata (inputs + frozen stops + fact-bank) and the generated copy. It
//     must NOT invoke outside-world facts (real hours, real menus, real
//     geography it wasn't told). The rubric is Kelowna-specific so
//     city_context_fit can be judged from the locale the copy claims, not from
//     the model's own city knowledge.
//   - Output is JSON-only. We parse + validate strictly and THROW on anything
//     malformed (not an object, missing a dimension, score out of 1..5 range,
//     missing/empty evidence). A throw signals a judge-call failure to the
//     runner; it is never silently coerced.

import type { Fixture, JudgeScores, WrittenDate } from './types';
import type { InvokeLLM } from './writingPass';

/** The six judged dimensions, in canonical order. */
const DIMENSIONS = [
  'desirability',
  'arc',
  'vibe_coherence',
  'city_context_fit',
  'specificity_taste',
  'hook',
] as const satisfies ReadonlyArray<keyof JudgeScores>;

/** Per-dimension evidence — one short justification string for each score. */
export type JudgeEvidence = Record<keyof JudgeScores, string>;

/** What `judge` resolves to: the six scores plus matching evidence. */
export interface JudgeResult {
  scores: JudgeScores;
  evidence: JudgeEvidence;
}

/** Options for `judge`. The LLM call is injected (tests mock it). */
export interface JudgeOptions {
  invokeLLM: InvokeLLM;
}

const SCORE_MIN = 1;
const SCORE_MAX = 5;

/**
 * The locale the judge grades against. The harness is Kelowna-only today; the
 * rubric names the city explicitly so `city_context_fit` is judged from what
 * the copy claims about THIS locale rather than from the model's own world
 * knowledge (which is forbidden — see SYSTEM_PROMPT).
 */
export const JUDGE_CITY = 'Kelowna, BC';

/**
 * The judge rubric / system prompt. Structure:
 *   1. Role + the single locale it grades for.
 *   2. The hard knowledge boundary (fixture metadata + copy ONLY).
 *   3. The six dimensions, each with a one-line definition and a 1..5 anchor.
 *   4. The evidence requirement (one quote-or-reason per dimension).
 *   5. The strict JSON-only output contract (exact shape, no prose, no fences).
 */
export const SYSTEM_PROMPT = [
  `You are a demanding local editor in ${JUDGE_CITY}. You grade a single written date plan for quality. You are not the writer; you are the judge.`,
  '',
  'KNOWLEDGE BOUNDARY (strict): Judge ONLY from the user context and the place facts you are given plus the generated copy. Do NOT use outside knowledge about real venues, real hours, real menus, or real geography. If the copy claims something, judge whether it reads true and specific for the given facts — never against your own memory of the city.',
  '',
  'Score each of the SIX dimensions on an integer 1..5 scale (1 = unacceptable, 3 = mediocre, 5 = excellent). Anchors:',
  '- desirability: would a real person in this city actually want to go on this date? 1 = nobody would tap it; 5 = genuinely want to go tonight.',
  '- arc: does the sequence build — energy, intimacy, pacing — across the stops? 1 = flat or backwards; 5 = a deliberate, satisfying progression.',
  '- vibe_coherence: do the stops and the copy hold one consistent vibe that matches the requested vibe? 1 = contradictory or off-brief; 5 = every beat reinforces the requested vibe.',
  `- city_context_fit: does the copy read as grounded in ${JUDGE_CITY} (lake, wine country, this locale) rather than generic anywhere-copy? 1 = could be any city; 5 = unmistakably here.`,
  '- specificity_taste: is the copy concrete and sensory (named items, real detail) rather than vague filler? 1 = vague/marketing-speak; 5 = sharp, specific, tasteful.',
  '- hook: does the title + hook stop the scroll and earn a tap? 1 = forgettable; 5 = irresistible without being clickbait.',
  '',
  'EVIDENCE (required): For every dimension provide one short evidence string (≤ 200 chars) citing the specific copy or fact that justifies the score. Evidence must be non-empty for all six dimensions.',
  '',
  'OUTPUT (strict): Return ONLY a single JSON object, no markdown fences, no prose before or after. Exact shape:',
  '{',
  '  "scores": { "desirability": <1-5>, "arc": <1-5>, "vibe_coherence": <1-5>, "city_context_fit": <1-5>, "specificity_taste": <1-5>, "hook": <1-5> },',
  '  "evidence": { "desirability": "<string>", "arc": "<string>", "vibe_coherence": "<string>", "city_context_fit": "<string>", "specificity_taste": "<string>", "hook": "<string>" }',
  '}',
].join('\n');

/**
 * Build the user message: the bounded knowledge the judge may reason from —
 * the user inputs, the frozen stops with their fact-bank, and the generated
 * copy under judgement. Nothing else.
 */
export function buildJudgeUserMessage(
  writtenDate: WrittenDate,
  fixture: Fixture,
): string {
  const { inputs } = fixture;
  const lines: string[] = [];

  lines.push('USER CONTEXT (the brief the date must satisfy):');
  lines.push(`- Occasion: ${inputs.occasion}`);
  lines.push(`- Requested vibe: ${inputs.vibe.join(', ') || '(none specified)'}`);
  lines.push(`- Budget: ~$${inputs.budget_per_person}/person`);
  lines.push(`- Total time: ~${inputs.duration_min} minutes`);
  lines.push(`- Effort: ${inputs.effort}`);
  if (inputs.intent) lines.push(`- Goal: ${inputs.intent}`);
  if (inputs.time_of_day) lines.push(`- Time of day: ${inputs.time_of_day}`);
  if (inputs.note && inputs.note.trim()) {
    lines.push(`- Special note: "${inputs.note.trim()}"`);
  }

  lines.push('');
  lines.push('PLACE FACTS (the ONLY ground truth — do not add outside facts):');
  for (const stop of fixture.stops) {
    const f = stop.facts;
    lines.push(`- ${stop.start_time} · ${stop.place_name} (${stop.place_type})`);
    if (f.allowed_claims.length) {
      lines.push(`    true of this place: ${f.allowed_claims.join(', ')}`);
    }
    if (f.signature_items?.length) {
      lines.push(`    signature items: ${f.signature_items.join(', ')}`);
    }
    if (f.setting_tags.length) {
      lines.push(`    setting: ${f.setting_tags.join(', ')}`);
    }
    if (f.sensory_tags.length) {
      lines.push(`    sensory: ${f.sensory_tags.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('GENERATED COPY UNDER JUDGEMENT:');
  lines.push(`- Title: ${writtenDate.title}`);
  lines.push(`- Hook: ${writtenDate.hook}`);
  lines.push(`- Why it works: ${writtenDate.why_it_works}`);
  lines.push('- Stops:');
  for (const stop of writtenDate.stops) {
    lines.push(`    · ${stop.place_name}: ${stop.what_to_do}`);
  }

  lines.push('');
  lines.push('Score all six dimensions 1..5 with one evidence string each. Return ONLY the JSON object.');
  return lines.join('\n');
}

/** Internal: the raw shape the LLM is asked to return. */
interface RawJudgeResponse {
  scores?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

/**
 * Parse + STRICTLY validate the judge's JSON response. Throws on any defect:
 * not a JSON object, missing scores/evidence blocks, a missing dimension, a
 * score that is not an integer in 1..5, or a missing/empty evidence string.
 */
export function parseJudgeResponse(text: string): JudgeResult {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `judge response was not valid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('judge response was not a JSON object');
  }

  const { scores: rawScores, evidence: rawEvidence } = parsed as RawJudgeResponse;

  if (typeof rawScores !== 'object' || rawScores === null) {
    throw new Error('judge response missing "scores" object');
  }
  if (typeof rawEvidence !== 'object' || rawEvidence === null) {
    throw new Error('judge response missing "evidence" object');
  }

  const scores = {} as JudgeScores;
  const evidence = {} as JudgeEvidence;

  for (const dim of DIMENSIONS) {
    const score = (rawScores as Record<string, unknown>)[dim];
    if (typeof score !== 'number' || !Number.isInteger(score)) {
      throw new Error(`judge score for "${dim}" must be an integer, got ${JSON.stringify(score)}`);
    }
    if (score < SCORE_MIN || score > SCORE_MAX) {
      throw new Error(`judge score for "${dim}" out of range 1..5: ${score}`);
    }
    scores[dim] = score;

    const ev = (rawEvidence as Record<string, unknown>)[dim];
    if (typeof ev !== 'string' || ev.trim().length === 0) {
      throw new Error(`judge evidence for "${dim}" must be a non-empty string`);
    }
    evidence[dim] = ev;
  }

  return { scores, evidence };
}

/**
 * Judge one written date against its fixture. Builds the Kelowna rubric prompt,
 * calls the injected LLM, parses + validates the JSON, and returns the six
 * scores with their evidence. Throws on a malformed judge response.
 *
 * The runner only calls this AFTER deterministic gates pass; this function does
 * not know about gates or score caps (see score.ts → finalScore for capping).
 */
export async function judge(
  writtenDate: WrittenDate,
  fixture: Fixture,
  options: JudgeOptions,
): Promise<JudgeResult> {
  const system = SYSTEM_PROMPT;
  const user = buildJudgeUserMessage(writtenDate, fixture);
  const raw = await options.invokeLLM({ system, user });
  return parseJudgeResponse(raw);
}
