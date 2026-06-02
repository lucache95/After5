// persist — the shared persistence step, extracted verbatim from the old
// generate-plan/index.ts step 8 (computeQualityScore → near-twin dedupe →
// insert → slug UPDATE → modifier join → withIds build). Every provider's
// Itinerary[] is persisted here identically, so a future Railway engine never
// has to learn our DB schema.
//
// computeQualityScore originally looked place types up via the `candidates`
// pool; we read stop.place_type instead (set at build + swap time, identical
// value) so persist needs no candidate pool — preserving behavior.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Itinerary, PlanInputs } from './types.ts';
import type { ModifierRow } from './providers/types.ts';

export interface PersistArgs {
  written: Itinerary[];
  inputs: PlanInputs;
  modPool: ModifierRow[];
  modifierIdsPicked: (string | null)[];
  sharedLog: Record<string, unknown>;
  userId: string | null;
  season: string;
}

export async function persist(
  supabase: SupabaseClient,
  { written, inputs, modPool, modifierIdsPicked, sharedLog, userId, season }: PersistArgs,
) {
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
    const typesPicked = new Set(stops.map((s) => s.place_type ?? 'unknown'));
    const typeDiversity = typesPicked.size / numStops;
    // wow factor — at least one anchor "memorable" type
    const WOW_TYPES = ['viewpoint', 'sunset_spot', 'winery', 'hike', 'beach'];
    const hasWow = stops.some((s) => WOW_TYPES.includes(s.place_type)) ? 1 : 0;
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
  // doesn't pollute /dates with two near-identical cards.
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
      (inserted as Array<{ id: string }>).map((row, idx) =>
        supabase
          .from('itineraries')
          .update({ slug: slugify(written[idx].title, row.id) })
          .eq('id', row.id)
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.error('slug update error', row.id, error.message);
          }),
      ),
    );
  }

  const modPoolById = new Map((modPool ?? []).map((m) => [m.id, m]));
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

  return withIds;
}

// Mirrors apps/web/lib/slug.ts so the canonical SEO URL we ship to the client
// matches what /dates/[slug] expects. Keep these in sync.
export function slugify(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const tail = id.replace(/-/g, '').slice(0, 6);
  return base ? `${base}-${tail}` : tail;
}
