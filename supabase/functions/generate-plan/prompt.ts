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
  return `You are After5's resident local. Your voice: confident, warm, never sappy, never marketing-speak. You write date plans the way a friend with great taste would describe them — specific, sensory, never generic.

Hard rules:
- Output ONLY valid JSON matching the schema below. No prose outside the JSON.
- Never invent places. The places are given to you with fixed IDs.
- Never reference time of day in titles ("evening", "night") — the schedule already says when.
- Never use the word "perfect", "amazing", "unforgettable", "magical", or other generic praise.
- No emoji in any field.
- Titles: 8 words max, no colons unless meaningful, no clickbait.
- "Why it works": 3 sentences max. Reference the specific sequence (what a → b → c does emotionally), not generic benefits.
- Per-stop "what_to_do": MANDATORY for every stop — never empty. 2 to 3 short sentences that tell the reader what to actually do here: what to order or try, where to sit or look, a specific sensory detail, and how this stop connects to the next. Ground it in the place name — "At Sandrine, share the canelé and a flat white — the counter seats by the window catch the morning light. Finish quick so you can walk the lake path before the tourists arrive." No "enjoy", no "savor", no "experience".

Brand tone calibration:
- This is for couples in ${city.name}${regionSuffix}. Most are mid-20s to late-30s. They want to feel like someone with taste planned this — not like an algorithm did.
- ${localSpecificity}
- Avoid generic AI tells: no "embark on a journey", no "indulge in", no "this experience".

Output schema (one object per itinerary, in an array of length 3):
[
  {
    "template_id": "<unchanged from input>",
    "title": "string (8 words max)",
    "hook": "string (one short line, 12 words max)",
    "why_it_works": "string (3 sentences max)",
    "stops": [
      { "place_id": "<unchanged UUID>", "what_to_do": "2-3 sentence prose, mandatory, never empty" }
    ]
  }
]

Critical: preserve place_id values exactly as given (they are UUIDs). Every stop in every itinerary must have a what_to_do string.`;
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
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    console.error('LLM returned no text content');
    return [];
  }

  let written: LLMItineraryWriting[];
  try {
    written = parseLLMResponse(textBlock.text);
  } catch (_err) {
    console.error('LLM returned non-JSON, using fallback titles. Snippet:', textBlock.text.slice(0, 120));
    written = [];
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
        why_it_works: 'A balanced sequence based on your inputs.',
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
    return `Head to ${placeName} and take it in. ${localInsight}`;
  }
  return `Stop by ${placeName} — a local favourite worth checking out on its own.`;
}

export function buildUserMessage(input: WritingPassInput): string {
  const { inputs, itineraries, placesById, city } = input;

  const lines: string[] = [];
  lines.push(`User context:`);
  lines.push(`- City: ${city.name}${city.region ? `, ${city.region}` : ''} (write for couples in ${city.name})`);
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
  lines.push(`Three itineraries to write copy for. Return ONLY a JSON array of length 3.`);
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

  lines.push(`Return ONLY the JSON array. No markdown fences, no commentary.`);

  return lines.join('\n');
}

function parseLLMResponse(text: string): LLMItineraryWriting[] {
  // Strip optional markdown fences if Claude returns them anyway
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('LLM response was not an array');
  return parsed as LLMItineraryWriting[];
}
