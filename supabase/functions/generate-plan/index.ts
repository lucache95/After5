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
  // Optional context fed to the LLM when writing why_it_works copy.
  // Pronouns let plans speak naturally ("she'll love the sunset"); empty
  // string = generic. Note is free-text from the user (anniversary, dietary,
  // pregnancy, etc.) capped at 280 chars.
  you_pronouns: z.enum(['she/her', 'he/him', 'they/them', '']).default(''),
  partner_pronouns: z.enum(['she/her', 'he/him', 'they/them', '']).default(''),
  note: z.string().max(280).default(''),
  // When = "tonight" → hard hours filter + low-friction bias.
  // "future" + future_date (yyyy-mm-dd) = wider scope, reservations OK.
  when: z.enum(['tonight', 'future']).default('tonight'),
  future_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  // Emotional goal — distinct from vibe. LLM tone hint; future scoring lever.
  intent: z.enum(['impress', 'chill', 'reconnect', 'try_something_new', '']).default(''),
  // Time-of-day frame. 'morning' = 10am slot start, 'evening' = 6pm,
  // 'all_day' = 10am with longer duration.
  time_of_day: z.enum(['morning', 'evening', 'all_day']).default('evening'),
  // Anonymous gate flow: when an unauthed user enters their email, we send
  // a magic link AND tag the resulting itineraries with claim_email so
  // /auth/callback can attach them to the user once they click the link.
  claim_email: z.string().email().optional(),
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

    // 2a. Pull user_id from the caller's JWT if present. supabase.functions.invoke()
    // forwards the session token in Authorization. We don't require auth — anonymous
    // generations still work — but when we have it, we tag the itinerary so the user
    // sees it in their dashboard.
    const authHeader = req.headers.get('Authorization');
    const userId = extractUserIdFromAuthHeader(authHeader);
    console.log('[generate-plan] auth header present:', !!authHeader, 'header_prefix:', authHeader?.slice(0, 30) ?? 'none', 'extracted user_id:', userId);

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

    // Audit log scaffold — populated as we go, attached to each itinerary
    // on insert. Lets us answer "why did this plan look like that?" without
    // re-running the function.
    const sharedLog: Record<string, unknown> = {
      inputs,
      candidate_pool_size: candidates.length,
      templates_considered: allTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        slot_types: t.slots.map((s) => s.types[0]),
        satisfies_must_includes: true, // these survived the filter, by definition
      })),
      templates_selected: topTemplates.map((t) => t.id),
    };

    // Slot-start time for hours filtering. The downstream scoring expects a
    // plain "HH:MM" string. Driven by time_of_day:
    //   morning / all_day → 10:00
    //   evening → 18:00
    // Explicit start_at overrides everything (legacy / API users).
    const effectiveStartAt = (() => {
      if (inputs.start_at) {
        const m = inputs.start_at.match(/T(\d{2}:\d{2})/);
        return m ? m[1] : '18:00';
      }
      if (inputs.time_of_day === 'morning' || inputs.time_of_day === 'all_day') return '10:00';
      return '18:00';
    })();

    // 5. Build one itinerary per template, tracking which place_ids have been
    //    used across the batch so each subsequent itinerary picks distinct
    //    spots (cross-plan diversity). Stochastic top-K inside scoring also
    //    means re-running the same inputs produces different plans.
    // Retry up to 3 times per template since stochastic top-5 can roll a
    // budget-busting combo. Almost always succeeds within 1-2 tries.
    function buildWithRetry(t: typeof topTemplates[number]): Itinerary | null {
      // First 3 attempts: strict (with hours filter). If they all fail —
      // usually because the time-of-day filter is too tight (cocktail bars
      // at 10am, cafes at 9pm, etc.) — try once more without the hours
      // filter so the user always gets *something* rather than a 422.
      for (let attempt = 0; attempt < 3; attempt++) {
        const it = buildItineraryFromTemplate(t, candidates, inputs, effectiveStartAt, usedAcrossBatch);
        if (it) return it;
      }
      const relaxed = buildItineraryFromTemplate(t, candidates, inputs, effectiveStartAt, usedAcrossBatch, { skipHoursFilter: true });
      if (relaxed) return relaxed;
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

    // 5b. Adjacency validator — no two stops in the same category_group
    //     back-to-back (no two bars, no two cafes). Tries to swap one of the
    //     offending stops with a candidate from a different group; if that
    //     fails, leaves the plan and logs the violation so we can audit.
    const adjacencyFixes: Array<{ template_id: string; before: string[]; after: string[]; swaps: number }> = [];
    for (const it of itineraries) {
      const before = it.stops.map((s) => s.place_name);
      const swaps = fixAdjacency(it, candidates, usedAcrossBatch);
      if (swaps > 0) {
        adjacencyFixes.push({
          template_id: it.template_id,
          before,
          after: it.stops.map((s) => s.place_name),
          swaps,
        });
      }
    }

    sharedLog.adjacency_fixes = adjacencyFixes;

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

    // 7b. Scrub photos that don't match the season or stop time.
    // Drops snow shots in non-winter; drops daytime shots at evening stops.
    // Setting photo_url to null lets the frontend fall back to the type-based
    // image (handled by lib/place-image.ts on the client).
    const nowMonth0 = new Date().getMonth();
    const seasonNow =
      nowMonth0 >= 2 && nowMonth0 <= 4 ? 'spring' :
      nowMonth0 >= 5 && nowMonth0 <= 7 ? 'summer' :
      nowMonth0 >= 8 && nowMonth0 <= 10 ? 'fall' : 'winter';

    let photosScrubbed = 0;
    for (const it of written) {
      for (const stop of it.stops) {
        if (!stop.photo_url) continue;
        const place = placesById.get(stop.place_id);
        if (!place) continue;

        const startHour = parseInt(stop.start_time.split(':')[0] ?? '0', 10);
        const isEveningStop = startHour >= 19;

        // Reason 1: snow visible AND we're not in winter
        const isStaleSnow = place.photo_has_snow === true && seasonNow !== 'winter';
        // Reason 2: bright daytime photo at an evening stop
        const isWrongTime = isEveningStop && place.photo_time_of_day === 'day';

        if (isStaleSnow || isWrongTime) {
          stop.photo_url = null;
          photosScrubbed += 1;
        }
      }
    }
    if (photosScrubbed > 0) {
      sharedLog.photos_scrubbed = photosScrubbed;
    }

    // 8. Persist to DB.
    // Generate the slug AFTER insert (we need the row id), via UPDATE.
    // is_public=true so every new plan immediately becomes indexable SEO content.
    // Tag the season so we can filter /dates by what's in season later.
    const nowMonth = new Date().getMonth();
    const season =
      nowMonth >= 2 && nowMonth <= 4 ? 'spring' :
      nowMonth >= 5 && nowMonth <= 7 ? 'summer' :
      nowMonth >= 8 && nowMonth <= 10 ? 'fall' : 'winter';
    // Quality score per itinerary — composite signal we collect now and
    // (later) bias scoring with. Range 0-1. Components:
    //   cost_realism    — 1 - abs(total_cost - budget) / budget, clamped
    //   type_diversity  — distinct types / total stops
    //   has_wow         — bonus if a viewpoint/sunset/winery is in the plan
    //   feels_cheap     — bonus if total < 60% of budget AND a free stop
    function computeQualityScore(it: Itinerary): { score: number; parts: Record<string, number> } {
      const stops = it.stops;
      const numStops = Math.max(1, stops.length);
      // cost_realism — perfect at exactly the budget; penalty for over OR under
      const costGap = Math.abs(it.total_cost_pp - inputs.budget_per_person);
      const costRealism = Math.max(0, 1 - costGap / Math.max(20, inputs.budget_per_person));
      // type_diversity — distinct place types / total stops
      const typesPicked = new Set(stops.map((s) => {
        const p = candidates.find((c) => c.id === s.place_id);
        return p?.type ?? 'unknown';
      }));
      const typeDiversity = typesPicked.size / numStops;
      // wow factor — at least one anchor "memorable" type
      const WOW_TYPES = ['viewpoint', 'sunset_spot', 'winery', 'hike', 'beach'];
      const hasWow = stops.some((s) => {
        const p = candidates.find((c) => c.id === s.place_id);
        return p && WOW_TYPES.includes(p.type);
      }) ? 1 : 0;
      // feels_cheap signal
      const wellUnder = it.total_cost_pp < inputs.budget_per_person * 0.6;
      const hasFree = stops.some((s) => s.estimated_cost_pp === 0);
      const feelsCheap = (wellUnder && hasFree) ? 1 : 0;
      // Weighted composite — cost realism + type diversity weighted equally,
      // wow + feels-cheap as smaller bonuses.
      const score = costRealism * 0.4 + typeDiversity * 0.35 + hasWow * 0.15 + feelsCheap * 0.1;
      return {
        score: Math.round(score * 100) / 100,
        parts: {
          cost_realism: Math.round(costRealism * 100) / 100,
          type_diversity: Math.round(typeDiversity * 100) / 100,
          has_wow: hasWow,
          feels_cheap: feelsCheap,
        },
      };
    }

    // De-dupe at the source: if a near-twin (same template_id, ≥70% stop
    // overlap, generated in the last 30 days) is already public, this new
    // plan stays in the DB so the user sees it, but is_public=false so it
    // doesn't pollute /dates with two near-identical cards. User flagged
    // this when "Axes, Then Locked in a Room" and "Throw axes, then crack
    // a room" both showed up at the same time.
    const templateIds = Array.from(new Set(written.map((it) => it.template_id).filter(Boolean)));
    const sinceIso = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const { data: dupCandidates } = templateIds.length
      ? await supabase
          .from('itineraries')
          .select('template_id, stops')
          .in('template_id', templateIds)
          .eq('is_public', true)
          .gte('generated_at', sinceIso)
          .limit(500)
      : { data: [] };

    const existingByTpl = new Map<string, string[][]>();
    for (const r of (dupCandidates ?? []) as Array<{ template_id: string | null; stops: unknown }>) {
      if (!r.template_id) continue;
      const ids = (Array.isArray(r.stops) ? r.stops : [])
        .map((s) => (s as { place_id?: string }).place_id)
        .filter((x): x is string => !!x);
      if (!existingByTpl.has(r.template_id)) existingByTpl.set(r.template_id, []);
      existingByTpl.get(r.template_id)!.push(ids);
    }

    function isNearTwin(newIds: string[], tplId: string | null): boolean {
      if (!tplId || newIds.length === 0) return false;
      const cands = existingByTpl.get(tplId) ?? [];
      for (const cand of cands) {
        if (cand.length === 0) continue;
        const overlap = newIds.filter((id) => cand.includes(id)).length;
        const ratio = overlap / Math.max(newIds.length, cand.length);
        if (ratio >= 0.7) return true;
      }
      return false;
    }

    const insertRows = written.map((it, idx) => {
      const quality = computeQualityScore(it);
      const myStopIds = it.stops.map((s) => s.place_id).filter((x): x is string => !!x);
      const isPublic = !isNearTwin(myStopIds, it.template_id);
      return {
      template_id: it.template_id,
      inputs,
      stops: it.stops,
      title: it.title,
      hook: it.hook,
      why_it_works: it.why_it_works,
      total_cost_pp: it.total_cost_pp,
      total_duration_min: it.total_duration_min,
      is_public: isPublic,
      season,
      when_planned: inputs.when,
      planned_for_date: inputs.when === 'future' ? (inputs.future_date ?? null) : null,
      intent: inputs.intent || null,
      modifier_id: modifierIdsPicked[idx] ?? null,
      user_id: userId,
      claim_email: !userId && inputs.claim_email ? inputs.claim_email.toLowerCase() : null,
      generation_log: {
        ...sharedLog,
        this_itinerary: {
          template_id: it.template_id,
          template_name: it.template_name,
          chosen_place_ids: it.stops.map((s) => s.place_id),
          chosen_place_names: it.stops.map((s) => s.place_name),
          modifier_id: modifierIdsPicked[idx] ?? null,
          total_cost_pp: it.total_cost_pp,
          total_duration_min: it.total_duration_min,
          quality_score: quality.score,
          quality_parts: quality.parts,
        },
      },
      };
    });
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

// Map place_type → broad category so we can detect adjacency violations.
// Adjacent stops in the same group feel monotonous (two bars in a row,
// two cafes back-to-back). Cross-group adjacency (cafe → restaurant) is
// fine. Outdoor/view/activity are not enforced — feeling fresh outside
// matters less than the food/drink/sweet rhythm.
function categoryGroupForType(t: string | undefined | null): string {
  if (!t) return 'other';
  if (t === 'restaurant') return 'food';
  if (t === 'winery' || t === 'brewery' || t === 'cocktail_bar') return 'drink';
  if (t === 'cafe' || t === 'dessert' || t === 'ice_cream' || t === 'bakery') return 'sweet';
  return 'other';
}

const ENFORCED_GROUPS = new Set(['food', 'drink', 'sweet']);

// Walks the stops list, finds adjacent pairs in the same enforced category
// group, and tries to swap the second stop with a candidate from the same
// place_type but a different group (e.g. swap a 2nd cocktail bar for a
// brewery — same drink-vibe slot but different sub-group). Returns the
// number of successful swaps. Mutates `it.stops` in place.
function fixAdjacency(
  it: Itinerary,
  candidates: Place[],
  used: Set<string>,
): number {
  let swaps = 0;
  for (let i = 1; i < it.stops.length; i++) {
    const a = it.stops[i - 1];
    const b = it.stops[i];
    const ga = categoryGroupForType(a.place_type);
    const gb = categoryGroupForType(b.place_type);
    if (!ENFORCED_GROUPS.has(ga) || ga !== gb) continue;
    // Find a candidate that matches the original slot's place_type loosely
    // (any non-conflicting type from candidates, not already used in this
    // plan, and from a different category group than the previous stop).
    const used_in_plan = new Set(it.stops.map((s) => s.place_id));
    const swap = candidates.find((p) => {
      if (used_in_plan.has(p.id)) return false;
      if (used.has(p.id)) return false;
      const gp = categoryGroupForType(p.type);
      // Different group from previous stop, AND different from next stop if
      // there is one (avoid creating a new adjacency violation downstream).
      if (gp === ga) return false;
      const next = it.stops[i + 1];
      if (next) {
        const gn = categoryGroupForType(next.place_type);
        if (ENFORCED_GROUPS.has(gp) && gp === gn) return false;
      }
      return true;
    });
    if (!swap) continue;
    // Perform the swap. Preserve b's start_time + duration_min so the
    // schedule doesn't shift; the LLM writing pass re-renders what_to_do
    // downstream from the new place. estimated_cost_pp comes from the
    // swap's typical_per_person (or 0 if unknown).
    it.stops[i] = {
      place_id: swap.id,
      place_name: swap.name,
      place_slug: swap.slug,
      place_type: swap.type,
      start_time: b.start_time,
      duration_min: b.duration_min,
      drive_to_next_min: b.drive_to_next_min,
      estimated_cost_pp: swap.typical_per_person ?? 0,
      neighborhood: swap.neighborhood,
      lat: swap.lat,
      lng: swap.lng,
      address: swap.address ?? null,
      photo_url: swap.photo_url ?? null,
      local_insight: swap.local_insight ?? null,
      reservation_required: swap.reservation_required ?? false,
      reservation_url: swap.reservation_url ?? null,
    };
    used.add(swap.id);
    swaps += 1;
  }
  return swaps;
}

// Decode the JWT in the Authorization header without verifying signature.
// We only trust the user_id when the request hits us via a real Supabase
// client (which bundles a valid token); even if someone forges a token,
// the worst case is they tag a row with a user_id they don't own — and
// our RLS prevents them from reading anyone else's saved/private data
// from that point forward. Returns null if no header or malformed.
function extractUserIdFromAuthHeader(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url → base64
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded)) as { sub?: string; aud?: string };
    if (typeof decoded.sub === 'string' && /^[0-9a-f-]{36}$/i.test(decoded.sub)) {
      return decoded.sub;
    }
    return null;
  } catch {
    return null;
  }
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
