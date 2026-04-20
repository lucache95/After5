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
  must_includes: z.array(z.string()).max(12).default([]),
  drive_tolerance_min: z.number().int().min(0).max(120).default(20),
  // Max distance from Kelowna centroid (49.888, -119.496). 30 covers
  // Kelowna proper + West Kelowna + Lake Country. 100 catches Vernon, Big
  // White, Penticton.
  max_radius_km: z.number().int().min(5).max(150).default(30),
  // Out-and-about plans pull from the real catalog. At-home plans pull from
  // the virtual at-home activity pool only (cooking, fondue, fort, etc).
  location: z.enum(['out', 'home']).default('out'),
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

    // 5. Build one itinerary per template, tracking which place_ids have been
    //    used across the batch so each subsequent itinerary picks distinct
    //    spots (cross-plan diversity). Stochastic top-K inside scoring also
    //    means re-running the same inputs produces different plans.
    // Retry up to 3 times per template since stochastic top-5 can roll a
    // budget-busting combo. Almost always succeeds within 1-2 tries.
    function buildWithRetry(t: typeof topTemplates[number]): Itinerary | null {
      for (let attempt = 0; attempt < 3; attempt++) {
        const it = buildItineraryFromTemplate(t, candidates, inputs, inputs.start_at, usedAcrossBatch);
        if (it) return it;
      }
      return null;
    }

    const itineraries: Itinerary[] = [];
    const usedAcrossBatch = new Set<string>();
    for (const t of topTemplates) {
      const it = buildWithRetry(t);
      if (it) {
        itineraries.push(it);
        for (const stop of it.stops) usedAcrossBatch.add(stop.place_id);
      }
    }
    if (itineraries.length === 0) {
      return jsonResponse({ error: 'no_valid_itineraries', message: 'Could not assemble valid itineraries from the candidate pool.' }, 422);
    }

    // If we got fewer than 3 valid itineraries, try the remaining templates
    if (itineraries.length < 3 && allTemplates.length > topTemplates.length) {
      const remaining = allTemplates.filter((t) => !topTemplates.some((tt) => tt.id === t.id));
      for (const t of remaining) {
        if (itineraries.length >= 3) break;
        const it = buildWithRetry(t);
        if (it) {
          itineraries.push(it);
          for (const stop of it.stops) usedAcrossBatch.add(stop.place_id);
        }
      }
    }

    // 6. Pick a Wow-Factor modifier per itinerary. Different modifier per
    //    plan so the 3 returned itineraries each have their own twist.
    const { data: modPool } = await supabase
      .from('modifiers')
      .select('id, label, body, difficulty, vibe_affinity, occasion_affinity')
      .eq('is_active', true)
      .contains('occasion_affinity', [inputs.occasion]);
    const modifierIdsPicked: (string | null)[] = pickModifiersForBatch(
      modPool ?? [],
      inputs.vibe,
      itineraries.length,
    );

    // 7. LLM writing pass
    const placesById = new Map<string, Place>(candidates.map((p) => [p.id, p]));
    const written = await writeItineraries(
      Deno.env.get('ANTHROPIC_API_KEY')!,
      Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6',
      { inputs, itineraries, placesById }
    );

    // 8. Persist to DB.
    // Generate the slug AFTER insert (we need the row id), via UPDATE.
    // is_public=true so every new plan immediately becomes indexable SEO content.
    const insertRows = written.map((it, idx) => ({
      template_id: it.template_id,
      inputs,
      stops: it.stops,
      title: it.title,
      hook: it.hook,
      why_it_works: it.why_it_works,
      total_cost_pp: it.total_cost_pp,
      total_duration_min: it.total_duration_min,
      is_public: true,
      modifier_id: modifierIdsPicked[idx] ?? null,
    }));
    const { data: inserted, error: insertError } = await supabase
      .from('itineraries')
      .insert(insertRows)
      .select('id');
    if (insertError) {
      console.error('insert error', insertError);
      // Continue anyway — the user gets their plans even if save failed
    }

    // Build slug per row (needs id) then UPDATE per row. Tried upsert first,
    // but Supabase upsert sends an INSERT that fails the NOT NULL columns
    // (template_id, inputs, stops) so the conflict path never fires.
    if (inserted && inserted.length > 0) {
      await Promise.all(
        inserted.map((row, idx) =>
          supabase
            .from('itineraries')
            .update({ slug: slugify(written[idx].title, row.id) })
            .eq('id', row.id)
            .then(({ error }) => {
              if (error) console.error('slug update error', row.id, error.message);
            }),
        ),
      );
    }

    const modPoolById = new Map((modPool ?? []).map((m: any) => [m.id, m]));
    const withIds = written.map((it, idx) => {
      const mid = modifierIdsPicked[idx];
      const m = mid ? modPoolById.get(mid) : null;
      return {
        ...it,
        id: inserted?.[idx]?.id,
        slug: inserted?.[idx]?.id ? slugify(it.title, inserted[idx].id) : undefined,
        modifier: m
          ? { id: m.id, label: m.label, body: m.body, difficulty: m.difficulty }
          : null,
      };
    });

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

// Pick N distinct modifiers for the batch, weighted by vibe overlap so each
// plan tends to get a Wow-Factor that matches its mood. Random tie-break, so
// repeat generations vary. If the pool is exhausted, falls back to nulls.
function pickModifiersForBatch(
  pool: Array<{ id: string; vibe_affinity: string[] }>,
  userVibe: string[],
  count: number,
): (string | null)[] {
  const remaining = [...pool];
  const picked: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    if (remaining.length === 0) {
      picked.push(null);
      continue;
    }
    // Score by vibe overlap; weighted random across top half.
    const scored = remaining
      .map((m) => ({
        id: m.id,
        score:
          (m.vibe_affinity ?? []).filter((v) => userVibe.includes(v)).length * 3 +
          Math.random(),
      }))
      .sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, Math.max(1, Math.floor(scored.length / 2)));
    const choice = topK[Math.floor(Math.random() * topK.length)];
    picked.push(choice.id);
    const idx = remaining.findIndex((m) => m.id === choice.id);
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return picked;
}

// Mirrors apps/web/lib/slug.ts so the canonical SEO URL we ship to the client
// matches what /dates/[slug] expects. Keep these in sync.
function slugify(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const tail = id.replace(/-/g, '').slice(0, 6);
  return base ? `${base}-${tail}` : tail;
}
