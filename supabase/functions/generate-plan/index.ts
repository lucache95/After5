// generate-plan — After5's hybrid generation Edge Function.
//
// Flow:
//   1. Validate input (Zod)
//   2. Filter candidate places (deterministic SQL)
//   3. Score and select top 3 templates
//   4. Greedy slot fill per template → 3 candidate itineraries
//   5. LLM writing pass (Claude Sonnet 4.6) — adds title, hook, why_it_works, per-stop suggestions
//   6. Persist itineraries to DB
//   7. Return 3 itineraries
//
// Architecture invariant: the LLM never picks places. Place IDs are fixed
// before the LLM is called. This makes hallucination structurally impossible.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { z } from 'npm:zod@3.23.8';

import { corsHeaders } from '../_shared/cors.ts';
import { filterPlaces, coversAllMustIncludes } from './places-filter.ts';
import { loadTemplates, selectTopTemplates } from './templates.ts';
import { buildItineraryFromTemplate } from './scoring.ts';
import { writeItineraries } from './prompt.ts';
import type { Itinerary, Place } from './types.ts';

// ─── Input schema ──────────────────────────────────────────────────────

const InputSchema = z.object({
  occasion: z.enum(['date', 'solo', 'friends']).default('date'),
  duration_min: z.number().int().min(60).max(720).default(180),
  budget_per_person: z.number().nonnegative().max(1000).default(50),
  vibe: z.array(z.string()).min(1).max(3),
  must_includes: z.array(z.string()).max(8).default([]),
  drive_tolerance_min: z.number().int().min(0).max(120).default(20),
  effort: z.enum(['low', 'moderate', 'high']).default('low'),
  start_at: z.string().datetime().optional(),
});

// ─── Handler ───────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Validate input
    const body = await req.json();
    const parsed = InputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
    }
    const inputs = parsed.data;

    // 2. Set up Supabase client (service role for unrestricted reads/writes)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 3. Filter candidate places
    const candidates = await filterPlaces(supabase, inputs);
    if (candidates.length < 3) {
      return jsonResponse(
        { error: 'no_candidates', message: 'Not enough places match those filters. Try widening budget or vibe.' },
        422
      );
    }

    if (!coversAllMustIncludes(candidates, inputs.must_includes)) {
      return jsonResponse(
        { error: 'must_includes_unsatisfiable', message: 'No combination satisfies all must-includes for these inputs.' },
        422
      );
    }

    // 4. Load templates and pick top 3
    const allTemplates = await loadTemplates(supabase, inputs.occasion);
    const topTemplates = selectTopTemplates(allTemplates, inputs, 3);
    if (topTemplates.length === 0) {
      return jsonResponse({ error: 'no_template_match', message: 'No template matches those inputs.' }, 422);
    }

    // 5. Build one itinerary per template (greedy slot fill)
    const itineraries: Itinerary[] = [];
    for (const t of topTemplates) {
      const it = buildItineraryFromTemplate(t, candidates, inputs, inputs.start_at);
      if (it) itineraries.push(it);
    }
    if (itineraries.length === 0) {
      return jsonResponse({ error: 'no_valid_itineraries', message: 'Could not assemble valid itineraries from the candidate pool.' }, 422);
    }

    // If we got fewer than 3 valid itineraries, try the remaining templates
    if (itineraries.length < 3 && allTemplates.length > topTemplates.length) {
      const remaining = allTemplates.filter((t) => !topTemplates.some((tt) => tt.id === t.id));
      for (const t of remaining) {
        if (itineraries.length >= 3) break;
        const it = buildItineraryFromTemplate(t, candidates, inputs, inputs.start_at);
        if (it) itineraries.push(it);
      }
    }

    // 6. LLM writing pass
    const placesById = new Map<string, Place>(candidates.map((p) => [p.id, p]));
    const written = await writeItineraries(
      Deno.env.get('ANTHROPIC_API_KEY')!,
      Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6',
      { inputs, itineraries, placesById }
    );

    // 7. Persist to DB
    const insertRows = written.map((it) => ({
      template_id: it.template_id,
      inputs,
      stops: it.stops,
      title: it.title,
      hook: it.hook,
      why_it_works: it.why_it_works,
      total_cost_pp: it.total_cost_pp,
      total_duration_min: it.total_duration_min,
    }));
    const { data: inserted, error: insertError } = await supabase
      .from('itineraries')
      .insert(insertRows)
      .select('id');
    if (insertError) {
      console.error('insert error', insertError);
      // Continue anyway — the user gets their plans even if save failed
    }

    const withIds = written.map((it, idx) => ({
      ...it,
      id: inserted?.[idx]?.id,
    }));

    return jsonResponse({
      itineraries: withIds,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('generate-plan error', err);
    const msg = err instanceof Error ? err.message : 'unknown error';
    return jsonResponse({ error: 'internal', message: msg }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
