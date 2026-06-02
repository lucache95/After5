import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toTeaser } from '@/lib/create/blur-gate';
import type { Itinerary } from '../../../../../supabase/functions/generate-plan/types';

// Server-side proxy to the FROZEN generate-plan edge fn. Applies the blur-gate by
// auth state so anon users never receive premium fields. Retries kelowna on unknown_city.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const vibe = Array.isArray(body.vibe) ? (body.vibe as string[]) : [];
  if (vibe.length === 0) return NextResponse.json({ error: 'vibe_required' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const authed = !!user;

  const requestedCity = typeof body.city_slug === 'string' && body.city_slug ? body.city_slug : 'kelowna';

  async function gen(citySlug: string) {
    return supabase.functions.invoke<{ itineraries: Itinerary[] }>('generate-plan', {
      body: { ...body, city_slug: citySlug },
    });
  }

  let city = requestedCity;
  let fellBack = false;
  let { data, error } = await gen(requestedCity);
  // unknown_city → retry kelowna (multi-city not generatable until #67)
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if ((error && status === 422) && requestedCity !== 'kelowna') {
    city = 'kelowna';
    fellBack = true;
    ({ data, error } = await gen('kelowna'));
  }
  if (error || !data?.itineraries) {
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
  }

  return NextResponse.json({
    itineraries: toTeaser(data.itineraries, { authed }),
    authed,
    city,
    fellBack,
  });
}
