// Anthropic writing pass: takes 3 fully-assembled itineraries with real places
// and asks Claude to write the human-facing copy (title, hook, why_it_works,
// per-stop suggestions). Claude never picks places — the IDs are fixed.

import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import type { Itinerary, PlanInputs, Place } from './types.ts';

// M1: city-parameterized system prompt. Kelowna keeps its exact Okanagan
// sensory line (the established city loses nothing); any other city gets a
// generic local-specificity instruction so copy still feels grounded.
export interface PromptCity {
  name: string;
  region: string | null;
}

export function buildSystemPrompt(city: PromptCity): string {
  const localSpecificity = city.name === 'Kelowna'
    ? 'Lean into Okanagan specificity: lake light, vineyards, the bridge, the bluffs, sunset over the West side.'
    : `Lean into ${city.name} specificity — name real neighborhoods, local landmarks, the feel of the place.`;
  const regionSuffix = city.region ? `, ${city.region}` : '';
  return `You write copy for After5, a blind-dating app. The SPEAKER IS THE HOST: a real person who set up this night and is inviting a potential match they haven't met yet. Every line reads like the host talking to that one person. Lowercase, dry, specific, warm. Never a guidebook, never marketing-speak, never a tour brochure.

Voice rules (the register, field by field):
- hook: a first-person invitation from the host, 12 words max. It must carry the i/you/we register. GOOD: "i'll paddle if you keep up on the wall" or "i want to take you somewhere golden at 7pm". BAD (detached tagline): "Two ways to use your body, zero planning required."
- what_to_do (per stop): "we" voice, our plan at this stop. GOOD: "we start on the V0s. the point is laughing, not sending." BAD (imperative command at the reader): "Walk straight to the bouldering area and start on the V0s." Practical venue facts are welcome but framed as our plan: "ron does same-day delivery, so boards will be waiting" not "Call Ron today."
- why_it_works: the host's own rationale. First person is fine: "good talk needs something to do with your hands."
- title: stays evocative and descriptive. Do NOT force "i" into titles; titles are not first person.

Hard rules:
- Emit your copy by calling the emit_itineraries tool. Do not write prose outside the tool call.
- Never invent places. The places are given to you with fixed IDs.
- Never reference time of day in titles ("evening", "night"). The schedule already says when.
- Never use the word "perfect", "amazing", "unforgettable", "magical", or other generic praise.
- No emoji in any field. No em-dashes in any field.
- Titles: 8 words max, no colons unless meaningful, no clickbait.
- "Why it works": 3 sentences max. Reference the specific sequence (what a → b → c does emotionally), not generic benefits.
- Per-stop "what_to_do": MANDATORY for every stop, never empty. 2 to 3 short sentences of our plan here: what we order or try, where we sit or look, one specific sensory detail, and how this stop hands off to the next. Ground it in the place name: "we split the canelé and a flat white at sandrine. the counter seats by the window catch the morning light, and we leave before the tourists take the lake path." No "enjoy", no "savor", no "experience".

Brand tone calibration:
- The host is posting this night in ${city.name}${regionSuffix} for a match they haven't met. Most users are mid-20s to late-30s. The copy should feel like a person with taste set this up, not an algorithm.
- ${localSpecificity}
- Avoid generic AI tells: no "embark on a journey", no "indulge in", no "this experience".

Tool call: call emit_itineraries with an itineraries array of length 3. Each entry carries template_id, title, hook, why_it_works, and stops[] (place_id + what_to_do).

Critical: preserve template_id and place_id values exactly as given (they are UUIDs). Every stop in every itinerary must have a non-empty what_to_do string.`;
}

interface WritingPassInput {
  inputs: PlanInputs;
  itineraries: Itinerary[];
  placesById: Map<string, Place>;
  /** Editorial pack voice note — injected into the user message to set tone. */
  packVoiceNote?: string | null;
  /** M1: the city this generation is for. Threads into system + user copy. */
  city: PromptCity;
}

interface LLMItineraryWriting {
  template_id: string;
  title: string;
  hook: string;
  why_it_works: string;
  stops: { place_id: string; what_to_do: string }[];
}

// PLAN-01 (Area 1): forced tool-use schema for the copy pass. The field names
// are byte-identical to LLMItineraryWriting so mergeWriting/patchEmptyStops keep
// working (Pitfall 3 — schema/merge are two sources of truth; keep them aligned).
// Copy length (8-word titles etc.) is NOT enforced here — JSON-schema can't, and
// length stays in the eval gates (A4). The LLM still only writes copy over frozen
// place_ids; it never picks places.
export const ITINERARY_TOOL = {
  name: 'emit_itineraries',
  description:
    'Emit the written copy for each assembled itinerary. Preserve every template_id and place_id exactly as given — never invent, reorder, or drop a place.',
  input_schema: {
    type: 'object' as const,
    properties: {
      itineraries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            template_id: { type: 'string', description: 'Unchanged from input.' },
            title: { type: 'string', description: '8 words max; evocative + descriptive, NOT first person; no time-of-day; no generic praise.' },
            hook: { type: 'string', description: 'First-person invitation from the host, 12 words max; must carry the i/you/we register, never a detached tagline.' },
            why_it_works: { type: 'string', description: '3 sentences max; the host\'s own rationale (first person ok); reference the specific a→b→c sequence.' },
            stops: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  place_id: { type: 'string', description: 'Unchanged UUID from input.' },
                  what_to_do: { type: 'string', description: '2-3 sentences in "we" voice (our plan at this stop), mandatory, never empty; no imperative commands at the reader.' },
                },
                required: ['place_id', 'what_to_do'],
              },
            },
          },
          required: ['template_id', 'title', 'hook', 'why_it_works', 'stops'],
        },
      },
    },
    required: ['itineraries'],
  },
};

// Minimal structural shape of the Anthropic messages.create response we read.
// We avoid importing the SDK's ContentBlock type so this function is unit-testable
// under deno without resolving the npm: specifier at type-check time.
interface ToolUseResponse {
  content: Array<{ type: string; input?: unknown }>;
}

/**
 * Extract the forced tool_use itineraries from a messages.create response.
 * Returns [] when no tool_use block is present (deterministic fallback path
 * stays alive — T-09-03) or when its input lacks an itineraries array.
 */
export function extractToolUseItineraries(response: ToolUseResponse): LLMItineraryWriting[] {
  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') return [];
  const input = toolUse.input as { itineraries?: unknown } | null | undefined;
  if (!input || !Array.isArray(input.itineraries)) return [];
  return input.itineraries as LLMItineraryWriting[];
}

// Minimum character threshold for a what_to_do to be considered non-empty.
// Anything shorter than this is treated as a gap that needs retry/fallback.
const WHAT_TO_DO_MIN_LENGTH = 20;

export interface WriteResult {
  itineraries: Itinerary[];
  /** Number of stops that used the deterministic fallback. */
  fallback_count: number;
  /** place_name + place_id pairs for every stop that fell back. */
  fallback_stops: Array<{ place_id: string; place_name: string }>;
}

export async function writeItineraries(
  apiKey: string,
  model: string,
  input: WritingPassInput
): Promise<WriteResult> {
  const client = new Anthropic({ apiKey });

  // --- First LLM pass ---
  let written = await callLLMWritingPass(client, model, input);
  let merged = mergeWriting(input, written);

  // --- Check for empty/short what_to_do and retry once if needed ---
  const gapsAfterFirst = countWhatToDoGaps(merged);
  if (gapsAfterFirst > 0) {
    console.log(`[writing] ${gapsAfterFirst} stop(s) with empty/short what_to_do after first pass — retrying`);
    const retryWritten = await callLLMWritingPass(client, model, input);
    // Only patch stops that are still empty — don't clobber good copy from pass 1
    merged = patchEmptyStops(merged, retryWritten);
  }

  // --- Deterministic fallback for any still-empty stops ---
  const fallbackStops: Array<{ place_id: string; place_name: string }> = [];
  for (const it of merged) {
    for (const stop of it.stops) {
      if (!stop.what_to_do || stop.what_to_do.length < WHAT_TO_DO_MIN_LENGTH) {
        const place = input.placesById.get(stop.place_id);
        stop.what_to_do = buildFallbackWhatToDo(stop.place_name, place?.local_insight ?? null);
        fallbackStops.push({ place_id: stop.place_id, place_name: stop.place_name });
      }
    }
  }

  return {
    itineraries: merged,
    fallback_count: fallbackStops.length,
    fallback_stops: fallbackStops,
  };
}

/** Run a single LLM writing pass and return parsed results (empty array on failure). */
async function callLLMWritingPass(
  client: Anthropic,
  model: string,
  input: WritingPassInput
): Promise<LLMItineraryWriting[]> {
  const userMessage = buildUserMessage(input);

  // PLAN-01 (Area 1): forced tool-use copy pass. tool_choice pins the model to
  // emit_itineraries, so the API validates the schema for us — no fence-strip +
  // JSON.parse. The model still only writes copy over frozen place_ids.
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.7,
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(input.city),
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [ITINERARY_TOOL],
    tool_choice: { type: 'tool', name: ITINERARY_TOOL.name },
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  // Extract the tool_use block. No tool_use → keep the deterministic fallback
  // (T-09-03): mergeWriting fills fallback titles, patchEmptyStops/buildFallback
  // handle copy. Defense-in-depth: tool-use guarantees shape, not non-emptiness.
  const written = extractToolUseItineraries(response);
  if (written.length === 0) {
    console.error('LLM returned no emit_itineraries tool_use block, using fallback titles');
  }
  const whatToDoCounts = written.map(
    (w) => w.stops?.filter((s) => s.what_to_do && s.what_to_do.length > 0).length ?? 0,
  );
  console.log('LLM writing pass: what_to_do per itinerary:', whatToDoCounts.join(','));

  return written;
}

/** Merge LLM writing output back into the source itineraries. */
function mergeWriting(input: WritingPassInput, written: LLMItineraryWriting[]): Itinerary[] {
  return input.itineraries.map((it) => {
    const w = written.find((x) => x.template_id === it.template_id);
    if (!w) {
      return {
        ...it,
        title: it.template_name,
        hook: `${it.total_duration_min} min · $${it.total_cost_pp.toFixed(0)}/pp`,
        why_it_works: 'a sequence i put together around your time and budget.',
        stops: it.stops.map((s) => ({ ...s, what_to_do: s.what_to_do ?? '' })),
      };
    }
    return {
      ...it,
      title: w.title,
      hook: w.hook,
      why_it_works: w.why_it_works,
      stops: it.stops.map((s, i) => {
        const byIndex = w.stops[i];
        const byId = w.stops.find((x) => x.place_id === s.place_id);
        const what = byIndex?.what_to_do || byId?.what_to_do || '';
        return { ...s, what_to_do: what };
      }),
    };
  });
}

/** Count stops across all itineraries with empty or too-short what_to_do. */
function countWhatToDoGaps(itineraries: Itinerary[]): number {
  let gaps = 0;
  for (const it of itineraries) {
    for (const stop of it.stops) {
      if (!stop.what_to_do || stop.what_to_do.length < WHAT_TO_DO_MIN_LENGTH) gaps++;
    }
  }
  return gaps;
}

/**
 * Patch stops that still have empty what_to_do using copy from a retry pass.
 * Only overwrites empty stops — keeps good copy from the first pass intact.
 */
function patchEmptyStops(merged: Itinerary[], retryWritten: LLMItineraryWriting[]): Itinerary[] {
  return merged.map((it) => {
    const rw = retryWritten.find((x) => x.template_id === it.template_id);
    if (!rw) return it;
    return {
      ...it,
      stops: it.stops.map((s, i) => {
        if (s.what_to_do && s.what_to_do.length >= WHAT_TO_DO_MIN_LENGTH) return s;
        const byIndex = rw.stops[i];
        const byId = rw.stops.find((x) => x.place_id === s.place_id);
        const retryWhat = byIndex?.what_to_do || byId?.what_to_do || '';
        if (retryWhat.length >= WHAT_TO_DO_MIN_LENGTH) {
          return { ...s, what_to_do: retryWhat };
        }
        return s;
      }),
    };
  });
}

/**
 * Build a deterministic fallback what_to_do from the place name and local
 * insight. Used when both the initial pass and retry fail to produce copy.
 */
function buildFallbackWhatToDo(placeName: string, localInsight: string | null): string {
  if (localInsight && localInsight.length > 10) {
    return `we'll take our time at ${placeName}. ${localInsight}`;
  }
  return `we'll stop by ${placeName}, a local favourite worth the detour.`;
}

export function buildUserMessage(input: WritingPassInput): string {
  const { inputs, itineraries, placesById, city } = input;

  const lines: string[] = [];
  lines.push(`User context:`);
  lines.push(`- City: ${city.name}${city.region ? `, ${city.region}` : ''} (the host is posting this night in ${city.name} for a match they haven't met — write in the host's inviting voice)`);
  lines.push(`- Occasion: ${inputs.occasion}`);
  lines.push(`- Vibe: ${inputs.vibe.join(', ')}`);
  lines.push(`- Budget: ~$${inputs.budget_per_person}/person`);
  lines.push(`- Time: ~${inputs.duration_min} minutes total`);
  lines.push(`- Effort: ${inputs.effort}`);
  if (inputs.you_pronouns || inputs.partner_pronouns) {
    const you = inputs.you_pronouns || 'unspecified';
    const partner = inputs.partner_pronouns || 'unspecified';
    lines.push(`- You: ${you} · Your date: ${partner} (use these pronouns naturally where it fits — never force it)`);
  }
  if (inputs.intent) {
    const intentHint: Record<string, string> = {
      impress: 'They want this to land — write copy that conveys this is a special, well-considered evening. Lean into wow moments without being showy.',
      chill: 'They want low-key, no pressure. Copy should feel relaxed, easygoing, no breathless excitement.',
      reconnect: 'They want real conversation, no distractions. Emphasize quiet moments and the chance to actually talk — call out anything phone-free or sequenced for connection.',
      try_something_new: 'They want spots they haven\'t tried. Lean into the discovery angle — call out what makes each stop a fresh take.',
    };
    lines.push(`- Goal: ${inputs.intent} → ${intentHint[inputs.intent] ?? ''}`);
  }
  if (inputs.when === 'tonight') {
    lines.push(`- Timing: Tonight. Copy can use immediate language ("tonight", "right now"). No reservation language.`);
  } else if (inputs.when === 'future' && inputs.future_date) {
    lines.push(`- Timing: Planning ahead for ${inputs.future_date}. Reservation language is fine.`);
  }
  if (inputs.note && inputs.note.trim().length > 0) {
    const note = inputs.note.trim();
    lines.push(`- Special note from the user: "${note}"`);
    lines.push(`  CRITICAL: This is the single most important context you have for personalization.`);
    lines.push(`  You MUST weave this note into at least ONE of the three itineraries' why_it_works`);
    lines.push(`  in a specific way — name the relationship/occasion/constraint they mentioned.`);
    lines.push(`  e.g. note "date with my wife" → "you and your wife" or "with your wife" appears naturally.`);
    lines.push(`  e.g. note "anniversary" → reference the occasion specifically, not generically.`);
    lines.push(`  e.g. note "vegetarian" → call out a specific veg-friendly stop in the why_it_works.`);
    lines.push(`  Don't be sappy or forced; do be specific. Skipping the note entirely is the worst sin.`);
    lines.push(`  Optionally hint at it in titles or hooks IF it fits naturally — never shoehorned.`);
  }
  // Editorial pack voice note — sets the overall tone for this generation.
  if (input.packVoiceNote) {
    lines.push('');
    lines.push(`TONE DIRECTIVE (from editorial pack — this overrides your default voice for this batch):`);
    lines.push(input.packVoiceNote);
  }
  lines.push('');
  lines.push(`Three itineraries to write copy for. Call the emit_itineraries tool with one entry per itinerary (length 3).`);
  lines.push('');

  for (const it of itineraries) {
    lines.push(`---`);
    lines.push(`Template: ${it.template_id} (${it.template_name})`);
    // Feels-cheap signal: total under budget AND at least one stop is free.
    // Tells the LLM to lean into the "punches above its price" angle.
    const hasFree = it.stops.some((s) => s.estimated_cost_pp === 0);
    const wellUnderBudget = it.total_cost_pp < inputs.budget_per_person * 0.6;
    const feelsCheap = hasFree && wellUnderBudget;
    if (feelsCheap) {
      lines.push(`Cost note: feels generous — total ($${it.total_cost_pp.toFixed(0)}) is well under their $${inputs.budget_per_person}/pp budget AND at least one stop is free. Call this out lightly in why_it_works.`);
    }
    lines.push(`Stops:`);
    for (const stop of it.stops) {
      const place = placesById.get(stop.place_id);
      if (!place) continue;
      const valTag = place.perceived_value === 'exceeds_price'
        ? ' [punches above its price]'
        : '';
      lines.push(`  - ${stop.start_time} · ${place.name} (${place.type})${valTag}`);
      lines.push(`      neighborhood: ${place.neighborhood}, vibe: ${place.vibe_tags.join(', ')}`);
      lines.push(`      ${stop.duration_min} min · $${stop.estimated_cost_pp.toFixed(0)}/pp`);
      if (place.local_insight) lines.push(`      local insight: ${place.local_insight}`);
      if (place.notes) lines.push(`      notes: ${place.notes}`);
    }
    lines.push(`Total: ${it.total_duration_min} min · $${it.total_cost_pp.toFixed(0)}/pp`);
    lines.push('');
  }

  lines.push(`Call emit_itineraries with one entry per itinerary. Preserve every template_id and place_id exactly.`);

  return lines.join('\n');
}
