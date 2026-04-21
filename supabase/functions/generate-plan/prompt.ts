// Anthropic writing pass: takes 3 fully-assembled itineraries with real places
// and asks Claude to write the human-facing copy (title, hook, why_it_works,
// per-stop suggestions). Claude never picks places — the IDs are fixed.

import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import type { Itinerary, PlanInputs, Place } from './types.ts';

const SYSTEM_PROMPT = `You are After5's resident local. Your voice: confident, warm, never sappy, never marketing-speak. You write date plans the way a friend with great taste would describe them — specific, sensory, never generic.

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
- This is for couples in Kelowna. Most are mid-20s to late-30s. They want to feel like someone with taste planned this — not like an algorithm did.
- Lean into Okanagan specificity: lake light, vineyards, the bridge, the bluffs, sunset over the West side.
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

interface WritingPassInput {
  inputs: PlanInputs;
  itineraries: Itinerary[];
  placesById: Map<string, Place>;
}

interface LLMItineraryWriting {
  template_id: string;
  title: string;
  hook: string;
  why_it_works: string;
  stops: { place_id: string; what_to_do: string }[];
}

export async function writeItineraries(
  apiKey: string,
  model: string,
  input: WritingPassInput
): Promise<Itinerary[]> {
  const client = new Anthropic({ apiKey });

  const userMessage = buildUserMessage(input);

  const response = await client.messages.create({
    model,
    // Richer 2-3 sentence per-stop prose means larger output — 4k leaves head-
    // room so the JSON never truncates mid-stop.
    max_tokens: 4096,
    temperature: 0.7,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('LLM returned no text content');
  }

  // If the LLM returns prose instead of JSON (rare but happens — Claude
  // occasionally explains why it can't comply), fall back to placeholder
  // copy so the user gets a usable plan instead of a 500.
  let written: LLMItineraryWriting[];
  try {
    written = parseLLMResponse(textBlock.text);
  } catch (err) {
    console.error('LLM returned non-JSON, using fallback titles. Snippet:', textBlock.text.slice(0, 120));
    written = [];
  }
  const whatToDoCounts = written.map(
    (w) => w.stops?.filter((s) => s.what_to_do && s.what_to_do.length > 0).length ?? 0,
  );
  console.log('LLM writing pass: what_to_do per itinerary:', whatToDoCounts.join(','));

  // Merge writing back into the itineraries (places are fixed; LLM only added copy)
  return input.itineraries.map((it) => {
    const w = written.find((x) => x.template_id === it.template_id);
    if (!w) {
      // Fall back to a deterministic placeholder so we never return empty strings
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
      // Match by ARRAY INDEX, not place_id. The LLM sometimes drops/mutates
      // UUIDs or returns a different number of stops than we sent; zipping by
      // order is robust and we know the LLM writes in the order we gave.
      stops: it.stops.map((s, i) => {
        const byIndex = w.stops[i];
        const byId = w.stops.find((x) => x.place_id === s.place_id);
        const what = byIndex?.what_to_do || byId?.what_to_do || '';
        return { ...s, what_to_do: what };
      }),
    };
  });
}

function buildUserMessage(input: WritingPassInput): string {
  const { inputs, itineraries, placesById } = input;

  const lines: string[] = [];
  lines.push(`User context:`);
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
