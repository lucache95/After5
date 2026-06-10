import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/profile/default-city — default a city-less profile to the launch city.
//
// P0 (2026-06-09 onboarding audit): nothing in the dating wizard sets
// profiles.primary_city_id, and browse_feed_for_viewer gates every row on
// st_dwithin against the viewer's city centroid — a NULL city NULLs the
// predicate and the most-committed user lands on an empty feed. This route is
// called from the preferences save (the one write point every dating signup
// passes through) and backfills the launch city server-side.
//
// Invariants:
//  - IDEMPOTENT: never overwrites a non-null primary_city_id (checked on read
//    AND re-guarded with .is('primary_city_id', null) on the write).
//  - TOLERANT: the launch city is looked up by slug (never a hardcoded uuid);
//    a missing/inactive row logs and no-ops — the funnel must never stall here.
//  - Self-scoped: RLS-bound server client + .eq('id', user.id) → a user can
//    only ever default their own row (profiles_owner_all). No admin client.

const LAUNCH_CITY_SLUG = 'kelowna';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('primary_city_id')
    .eq('id', user.id)
    .maybeSingle();
  // Already has a city (or no profile row to default) — nothing to do.
  if (!profile || profile.primary_city_id) {
    return NextResponse.json({ ok: true, defaulted: false });
  }

  // Launch city by slug — cities_public_read covers active rows. Tolerate the
  // row missing: log and no-op rather than failing the preferences save.
  const { data: city } = await supabase
    .from('cities')
    .select('id')
    .eq('slug', LAUNCH_CITY_SLUG)
    .eq('is_active', true)
    .maybeSingle();
  if (!city) {
    console.warn(`[profile/default-city] launch city '${LAUNCH_CITY_SLUG}' not found — skip`);
    return NextResponse.json({ ok: true, defaulted: false });
  }

  // Write-time idempotency guard: only fill a still-null city (a concurrent
  // planner-funnel save wins; we never clobber a real choice).
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ primary_city_id: city.id })
    .eq('id', user.id)
    .is('primary_city_id', null);
  if (updateError) {
    console.error('[profile/default-city] update failed', updateError);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, defaulted: true });
}
