// @after5/date-quality — offline wrapper around the generator writing pass.
//
// ── SEAM STATUS: FALLBACK (typed interface + injectable LLM call) ──
//
// The production writing pass lives in
//   supabase/functions/generate-plan/prompt.ts
// and is NOT cleanly importable from Node/vitest today, for two reasons
// documented in the seam recon:
//
//   1. Top-level Deno-only import:
//        import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
//      The `npm:` specifier is Deno-only. The static import must resolve for
//      the module to load, so Node/vitest cannot import prompt.ts as-is.
//   2. The pure prompt-building functions (buildUserMessage, parseLLMResponse,
//      mergeWriting, patchEmptyStops, buildFallbackWhatToDo) and the
//      WritingPassInput / LLMItineraryWriting types are NOT exported, and
//      `SYSTEM_PROMPT` is module-private.
//
// We deliberately do NOT copy the ~300 lines of Deno code here — it would
// drift from production and re-import the SDK path.
//
// TODO(seam): when the generator is refactored per the recon's recommendation
//   — split prompt.ts into a Deno-free `writing-copy.ts` (SYSTEM_PROMPT,
//   buildUserMessage, parseLLMResponse, mergeWriting, patchEmptyStops,
//   buildFallbackWhatToDo, WritingPassInput, LLMItineraryWriting) that the
//   Anthropic-bound prompt.ts re-exports — replace the local prompt assembly
//   below with a direct import of those pure functions so the offline harness
//   reuses production logic verbatim. Until then this wrapper builds an
//   equivalent prompt locally and reconstructs WriteResult shape itself.
//
// The LLM call is injected: tests pass a deterministic mock; real eval runs
// pass an Anthropic-backed caller. This wrapper never imports an SDK.

import type {
  Fixture,
  WriteResult,
  WrittenDate,
  WrittenStop,
} from './types';

/**
 * Injectable LLM caller. Given the assembled system + user prompt, returns the
 * raw model text (expected: a JSON array of length = number of itineraries).
 * Real runs back this with Anthropic; tests return canned JSON.
 */
export interface InvokeLLM {
  (args: { system: string; user: string }): Promise<string>;
}

/** Options for runWritingPass. */
export interface RunWritingPassOptions {
  invokeLLM: InvokeLLM;
}

/** Minimum char length for a what_to_do to count as non-empty (mirrors prod). */
const WHAT_TO_DO_MIN_LENGTH = 20;

/**
 * The raw per-itinerary contract the LLM is asked to return. Mirrors the
 * generator's internal LLMItineraryWriting shape (prompt.ts).
 */
interface RawWriting {
  template_id: string;
  title: string;
  hook: string;
  why_it_works: string;
  stops: Array<{ place_id: string; what_to_do: string }>;
}

/**
 * Run the writing pass offline for a single fixture.
 *
 * Assembles a prompt equivalent to the production writing pass, calls the
 * injected LLM, parses the JSON, and reconstructs a WriteResult (copy merged
 * onto the frozen stops, with deterministic fallback for empty what_to_do).
 *
 * NOTE: until the seam is cleaned up (see TODO above) the prompt text here is
 * a faithful local re-implementation, not a byte-for-byte copy of production.
 */
export async function runWritingPass(
  fixture: Fixture,
  options: RunWritingPassOptions,
): Promise<WriteResult> {
  const system = SYSTEM_PROMPT;
  const user = buildUserMessage(fixture);

  const raw = await options.invokeLLM({ system, user });

  let parsed: RawWriting[];
  try {
    parsed = parseLLMResponse(raw);
  } catch {
    parsed = [];
  }

  // Each fixture is one date (one frozen selection). Treat the fixture as a
  // single itinerary keyed by a synthetic template id derived from its id, but
  // also accept matching by place_id sequence so a mock can stay simple.
  const written = parsed[0];

  const fallback_stops: Array<{ place_id: string; place_name: string }> = [];

  const stops: WrittenStop[] = fixture.stops.map((s, i) => {
    const byIndex = written?.stops?.[i];
    const byId = written?.stops?.find((x) => x.place_id === s.place_id);
    let what = byIndex?.what_to_do || byId?.what_to_do || '';
    if (!what || what.length < WHAT_TO_DO_MIN_LENGTH) {
      what = buildFallbackWhatToDo(s.place_name);
      fallback_stops.push({ place_id: s.place_id, place_name: s.place_name });
    }
    return { place_id: s.place_id, place_name: s.place_name, what_to_do: what };
  });

  const date: WrittenDate = {
    template_id: written?.template_id ?? fixture.id,
    title: written?.title ?? fixture.id,
    hook: written?.hook ?? '',
    why_it_works: written?.why_it_works ?? '',
    stops,
  };

  return {
    itineraries: [date],
    fallback_count: fallback_stops.length,
    fallback_stops,
  };
}

// ── Local prompt assembly (TODO(seam): replace with imports from a Deno-free
//    writing-copy.ts once the generator is split). Kept intentionally compact.

const SYSTEM_PROMPT = [
  "You write copy for After5, a blind-dating app. The SPEAKER IS THE HOST: a person who set up this night, inviting a match they haven't met. Lowercase, dry, specific, warm — never a guidebook, never marketing-speak.",
  'hook = a first-person invitation (i/you/we register), never a detached tagline. what_to_do = "we" voice, our plan at this stop ("we start on the V0s"), never imperative commands at the reader ("Walk straight to..."). why_it_works = the host\'s own rationale, first person ok. Titles stay evocative and descriptive — do NOT force "i" into titles.',
  'Output ONLY a JSON array (length = number of itineraries). No prose outside the JSON.',
  'Never invent places. Never reference time of day in titles. No emoji. No em-dashes.',
  'Titles 8 words max. Hook 12 words max. why_it_works 3 sentences max.',
  'Every stop needs a 2-3 sentence what_to_do grounded in the place name. No "perfect", "amazing", "savor", "indulge".',
].join('\n');

/** Build the user message for a fixture. Equivalent to prompt.ts buildUserMessage. */
export function buildUserMessage(fixture: Fixture): string {
  const { inputs } = fixture;
  const lines: string[] = [];
  lines.push('User context:');
  lines.push(`- Occasion: ${inputs.occasion}`);
  lines.push(`- Vibe: ${inputs.vibe.join(', ')}`);
  lines.push(`- Budget: ~$${inputs.budget_per_person}/person`);
  lines.push(`- Time: ~${inputs.duration_min} minutes total`);
  lines.push(`- Effort: ${inputs.effort}`);
  if (inputs.intent) lines.push(`- Goal: ${inputs.intent}`);
  if (inputs.note && inputs.note.trim()) {
    lines.push(`- Special note from the user: "${inputs.note.trim()}"`);
  }
  if (fixture.packVoiceNote) {
    lines.push('');
    lines.push(`TONE DIRECTIVE: ${fixture.packVoiceNote}`);
  }
  lines.push('');
  lines.push('One itinerary to write copy for. Return ONLY a JSON array of length 1.');
  lines.push('---');
  lines.push(`Template: ${fixture.id}`);
  lines.push('Stops:');
  for (const stop of fixture.stops) {
    const facts = stop.facts;
    lines.push(`  - ${stop.start_time} · ${stop.place_name} (${stop.place_type})`);
    if (facts.allowed_claims.length) {
      lines.push(`      true of this place: ${facts.allowed_claims.join(', ')}`);
    }
    if (facts.signature_items?.length) {
      lines.push(`      signature items: ${facts.signature_items.join(', ')}`);
    }
    lines.push(`      ${stop.duration_min} min · $${stop.estimated_cost_pp.toFixed(0)}/pp`);
  }
  lines.push('Return ONLY the JSON array. No markdown fences, no commentary.');
  return lines.join('\n');
}

/** Strip optional markdown fences and parse the LLM JSON array. */
export function parseLLMResponse(text: string): RawWriting[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('LLM response was not an array');
  return parsed as RawWriting[];
}

/** Deterministic fallback what_to_do — mirrors prompt.ts buildFallbackWhatToDo. */
export function buildFallbackWhatToDo(placeName: string): string {
  return `we'll stop by ${placeName}, a local favourite worth the detour.`;
}
