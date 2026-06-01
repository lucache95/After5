import { assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildSystemPrompt, buildUserMessage } from './prompt.ts';

Deno.test('buildSystemPrompt injects city + region, not hardcoded Kelowna', () => {
  const sys = buildSystemPrompt({ name: 'Vernon', region: 'BC' });
  assertStringIncludes(sys, 'Vernon');
  // Default Kelowna call still mentions Kelowna (back-compat)
  assertStringIncludes(buildSystemPrompt({ name: 'Kelowna', region: 'BC' }), 'Kelowna');
});

Deno.test('buildUserMessage states the city for couples', () => {
  const msg = buildUserMessage({
    inputs: { occasion: 'date', vibe: ['chill'], budget_per_person: 50, duration_min: 180, effort: 'low', must_includes: [] } as any,
    itineraries: [], placesById: new Map(), city: { name: 'Vernon', region: 'BC' },
  } as any);
  assertStringIncludes(msg, 'Vernon');
});
