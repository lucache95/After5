// GET /api/admin/eval?period=7d|30d|all — generation quality dashboard data.
// Gated by requireAdmin. Aggregates itineraries, saved_plans, plan_feedback,
// and generation_log quality scores into the shape the EvalDashboard expects.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';

type Period = '7d' | '30d' | 'all';

function periodToDate(period: Period): string | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin('/admin/eval');
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const period = (req.nextUrl.searchParams.get('period') ?? '7d') as Period;
  if (!['7d', '30d', 'all'].includes(period)) {
    return NextResponse.json({ error: 'invalid_period' }, { status: 400 });
  }

  const since = periodToDate(period);
  const admin = createAdminClient();

  // ─── 1. Itineraries (generations + quality scores) ────────────────
  let itinQuery = admin
    .from('itineraries')
    .select('id, generated_at, generation_log, template_id, title, slug, stops, total_cost_pp, total_duration_min');
  if (since) itinQuery = itinQuery.gte('generated_at', since);
  const { data: itineraries } = await itinQuery;
  const allItineraries = itineraries ?? [];

  const totalGens = allItineraries.length;

  // Extract quality scores from generation_log JSONB.
  // Quality scores are stored as 0-1 floats; multiply by 10 for display.
  const qualityScores: number[] = [];
  for (const it of allItineraries) {
    const log = it.generation_log as Record<string, unknown> | null;
    if (log && typeof log === 'object') {
      const score =
        (log as Record<string, unknown>).quality_score ??
        (log as Record<string, unknown>).score;
      if (typeof score === 'number' && score >= 0 && score <= 1) {
        qualityScores.push(score * 10);
      }
    }
  }
  const avgQuality =
    qualityScores.length > 0
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : null;

  // ─── 2. Saved plans ──────────────────────────────────────────────
  let savesQuery = admin.from('saved_plans').select('id, itinerary_id');
  if (since) savesQuery = savesQuery.gte('saved_at', since);
  const { data: savedPlans } = await savesQuery;
  const totalSaves = (savedPlans ?? []).length;
  const saveRate = totalGens > 0 ? Math.round((totalSaves / totalGens) * 100) : 0;

  // ─── 3. Plan feedback ────────────────────────────────────────────
  let fbQuery = admin.from('plan_feedback').select('id, would_do, stop_votes');
  if (since) fbQuery = fbQuery.gte('created_at', since);
  const { data: feedbackRows } = await fbQuery;
  const allFeedback = feedbackRows ?? [];
  const totalFeedback = allFeedback.length;

  let positiveCount = 0;
  for (const fb of allFeedback) {
    if (fb.would_do === 'yes' || fb.would_do === 'maybe') positiveCount++;
  }
  const feedbackPositivity =
    totalFeedback > 0 ? Math.round((positiveCount / totalFeedback) * 100) : null;

  // ─── 4. Pack (template) breakdown ────────────────────────────────
  const packMap = new Map<string, { activations: number; saved: Set<string> }>();
  const savedItinIds = new Set((savedPlans ?? []).map((s) => s.itinerary_id));
  for (const it of allItineraries) {
    const name = it.template_id ?? 'unknown';
    if (!packMap.has(name)) packMap.set(name, { activations: 0, saved: new Set() });
    const entry = packMap.get(name)!;
    entry.activations++;
    if (savedItinIds.has(it.id)) entry.saved.add(it.id);
  }
  const packBreakdown = [...packMap.entries()]
    .map(([name, v]) => ({
      name,
      activations: v.activations,
      saveRate: v.activations > 0 ? Math.round((v.saved.size / v.activations) * 100) : 0,
    }))
    .sort((a, b) => b.activations - a.activations);

  // ─── 5. Venue frequency (from itinerary stops) ───────────────────
  const venueMap = new Map<
    string,
    { name: string; appearances: number; loved: number; skipped: number }
  >();
  for (const it of allItineraries) {
    const stops = Array.isArray(it.stops) ? it.stops : [];
    for (const stop of stops as Array<{ place_id?: string; place_name?: string }>) {
      if (!stop.place_id) continue;
      if (!venueMap.has(stop.place_id)) {
        venueMap.set(stop.place_id, {
          name: stop.place_name ?? stop.place_id.slice(0, 8),
          appearances: 0,
          loved: 0,
          skipped: 0,
        });
      }
      venueMap.get(stop.place_id)!.appearances++;
    }
  }

  // Enrich with feedback loved/skipped from the feedback table
  let venueFbQuery = admin.from('feedback').select('loved_place_id, skipped_place_id');
  if (since) venueFbQuery = venueFbQuery.gte('created_at', since);
  const { data: venueFb } = await venueFbQuery;
  for (const fb of venueFb ?? []) {
    if (fb.loved_place_id && venueMap.has(fb.loved_place_id)) {
      venueMap.get(fb.loved_place_id)!.loved++;
    }
    if (fb.skipped_place_id && venueMap.has(fb.skipped_place_id)) {
      venueMap.get(fb.skipped_place_id)!.skipped++;
    }
  }

  const venueFrequency = [...venueMap.entries()]
    .map(([placeId, v]) => ({
      placeId,
      ...v,
      sentiment: (
        v.loved > v.skipped ? 'positive' : v.skipped > v.loved ? 'negative' : 'neutral'
      ) as 'positive' | 'neutral' | 'negative',
    }))
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 20);

  // ─── 6. Worst dates (bottom 5 by quality score) ──────────────────
  const scoredItineraries = allItineraries
    .map((it) => {
      const log = it.generation_log as Record<string, unknown> | null;
      const rawScore =
        log && typeof log === 'object'
          ? ((log as Record<string, unknown>).quality_score ??
             (log as Record<string, unknown>).score)
          : null;
      const qs = typeof rawScore === 'number' ? rawScore * 10 : null;
      const stops = Array.isArray(it.stops) ? it.stops : [];
      return {
        id: it.id,
        title: it.title ?? 'Untitled',
        slug: it.slug ?? null,
        qualityScore: qs,
        generatedAt: it.generated_at,
        stopNames: (stops as Array<{ place_name?: string }>)
          .map((s) => s.place_name ?? 'Stop')
          .slice(0, 5),
      };
    })
    .filter((d) => d.qualityScore !== null)
    .sort((a, b) => (a.qualityScore ?? 0) - (b.qualityScore ?? 0))
    .slice(0, 5);

  return NextResponse.json({
    period,
    totalGens,
    avgQuality,
    saveRate,
    totalSaves,
    feedbackPositivity,
    totalFeedback,
    packBreakdown,
    venueFrequency,
    worstDates: scoredItineraries,
  });
}
