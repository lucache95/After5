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

  const written = parseLLMResponse(textBlock.text);

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
      stops: it.stops.map((s) => {
        const ws = w.stops.find((x) => x.place_id === s.place_id);
        return { ...s, what_to_do: ws?.what_to_do };
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
  lines.push('');
  lines.push(`Three itineraries to write copy for. Return ONLY a JSON array of length 3.`);
  lines.push('');

  for (const it of itineraries) {
    lines.push(`---`);
    lines.push(`Template: ${it.template_id} (${it.template_name})`);
    lines.push(`Stops:`);
    for (const stop of it.stops) {
      const place = placesById.get(stop.place_id);
      if (!place) continue;
      lines.push(`  - ${stop.start_time} · ${place.name} (${place.type})`);
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
