import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toTeaser } from '@/lib/create/blur-gate';
import type { Itinerary } from '../../../../../supabase/functions/generate-plan/types';

// Server-side proxy to the FROZEN generate-plan edge fn. Applies the blur-gate by
// auth state so anon users never receive premium fields.
//
// Open-city: when the caller sends `city_query` (free text the user typed), we
// forward it. The edge fn geocodes it into an ad-hoc city and warms it on the
// fly, so there's no closed-city fallback anymore. Legacy `city_slug` callers
// still work unchanged.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const vibe = Array.isArray(body.vibe) ? (body.vibe as string[]) : [];
  if (vibe.length === 0) return NextResponse.json({ error: 'vibe_required' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const authed = !!user;

  const cityQuery = typeof body.city_query === 'string' ? body.city_query.trim() : '';
  // A request must carry either a free-text city or a legacy slug. Default the
  // slug to kelowna only when neither is present (back-compat with old callers).
  const citySlug = typeof body.city_slug === 'string' && body.city_slug ? body.city_slug : undefined;
  if (!cityQuery && !citySlug) {
    return NextResponse.json({ error: 'city_required' }, { status: 400 });
  }

  const { data, error } = await supabase.functions.invoke<{ itineraries: Itinerary[] }>('generate-plan', {
    body: { ...body, ...(cityQuery ? { city_query: cityQuery } : {}), ...(citySlug ? { city_slug: citySlug } : {}) },
  });

  if (error || !data?.itineraries) {
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
  }

  return NextResponse.json({
    itineraries: toTeaser(data.itineraries, { authed }),
    authed,
    city: cityQuery || citySlug,
  });
}
