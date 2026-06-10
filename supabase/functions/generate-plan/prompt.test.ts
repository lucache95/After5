import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  buildSystemPrompt,
  buildUserMessage,
  ITINERARY_TOOL,
  extractToolUseItineraries,
} from './prompt.ts';

Deno.test('buildSystemPrompt injects city + region, not hardcoded Kelowna', () => {
  const sys = buildSystemPrompt({ name: 'Vernon', region: 'BC' });
  assertStringIncludes(sys, 'Vernon');
  // Default Kelowna call still mentions Kelowna (back-compat)
  assertStringIncludes(buildSystemPrompt({ name: 'Kelowna', region: 'BC' }), 'Kelowna');
});

Deno.test('buildSystemPrompt enforces the host invitation voice', () => {
  const sys = buildSystemPrompt({ name: 'Kelowna', region: 'BC' });
  // The speaker is the host inviting a match — not a guidebook.
  assertStringIncludes(sys, 'SPEAKER IS THE HOST');
  assertStringIncludes(sys, 'first-person invitation');
  // The in-prompt GOOD/BAD contrast pair is present.
  assertStringIncludes(sys, 'i\'ll paddle if you keep up on the wall');
  assertStringIncludes(sys, 'Walk straight to the bouldering area');
  assertStringIncludes(sys, 'we start on the V0s');
  // Titles stay descriptive — first person is NOT forced into them.
  assertStringIncludes(sys, 'Do NOT force "i" into titles');
});

Deno.test('ITINERARY_TOOL: hook + what_to_do descriptions carry the host voice', () => {
  const props = ITINERARY_TOOL.input_schema.properties as Record<string, any>;
  const itemProps = props.itineraries.items.properties as Record<string, any>;
  assertStringIncludes(itemProps.hook.description, 'First-person invitation');
  const stopProps = itemProps.stops.items.properties as Record<string, any>;
  assertStringIncludes(stopProps.what_to_do.description, '"we" voice');
});

Deno.test('buildUserMessage frames the city as the host posting for a match', () => {
  const msg = buildUserMessage({
    inputs: { occasion: 'date', vibe: ['chill'], budget_per_person: 50, duration_min: 180, effort: 'low', must_includes: [] } as any,
    itineraries: [], placesById: new Map(), city: { name: 'Vernon', region: 'BC' },
  } as any);
  assertStringIncludes(msg, 'Vernon');
  assertStringIncludes(msg, "host is posting this night in Vernon");
});

// ─── Tool-use migration (PLAN-01, Area 1) ───────────────────────────────

Deno.test('ITINERARY_TOOL: schema field names are byte-identical to LLMItineraryWriting', () => {
  // Pitfall 3: schema field names MUST match the merge logic's expectations.
  assertEquals(ITINERARY_TOOL.name, 'emit_itineraries');
  const props = ITINERARY_TOOL.input_schema.properties as Record<string, any>;
  const itemProps = props.itineraries.items.properties as Record<string, any>;
  assertEquals(Object.keys(itemProps).sort(), ['hook', 'stops', 'template_id', 'title', 'why_it_works']);
  const stopProps = itemProps.stops.items.properties as Record<string, any>;
  assertEquals(Object.keys(stopProps).sort(), ['place_id', 'what_to_do']);
});

Deno.test('extractToolUseItineraries: pulls itineraries from a forced tool_use block', () => {
  const response = {
    content: [
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'emit_itineraries',
        input: {
          itineraries: [
            {
              template_id: 't1',
              title: 'A Lake-Light Morning',
              hook: 'i want to take you somewhere slow before the view.',
              why_it_works: 'coffee, then a walk, then the bluffs.',
              stops: [{ place_id: 'place-a', what_to_do: 'we split the canelé and a flat white.' }],
            },
          ],
        },
      },
    ],
  };
  const written = extractToolUseItineraries(response as any);
  assertEquals(written.length, 1);
  assertEquals(written[0].template_id, 't1');
  assertEquals(written[0].stops[0].place_id, 'place-a');
  assertStringIncludes(written[0].stops[0].what_to_do, 'canelé');
});

Deno.test('extractToolUseItineraries: returns [] when no tool_use block is present (fallback path)', () => {
  const response = { content: [{ type: 'text', text: 'sorry, I refuse' }] };
  assertEquals(extractToolUseItineraries(response as any), []);
});

Deno.test('extractToolUseItineraries: returns [] when tool_use input has no itineraries array', () => {
  const response = {
    content: [{ type: 'tool_use', id: 'x', name: 'emit_itineraries', input: { wrong: true } }],
  };
  assertEquals(extractToolUseItineraries(response as any), []);
});
