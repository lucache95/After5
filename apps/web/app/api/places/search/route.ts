// M3.5 — Google Places (New) Text Search proxy.
//
// POST { query, lat?, lng?, radiusKm? } → { results: Stop[] } where each result is an
// inline custom stop (place_id = `custom:<googleId>`). The host adds one to their date
// from the editor; the pick is recorded to the custom_venue_submissions queue client-side.
//
// Key safety: GOOGLE_PLACES_API_KEY is read from the SERVER env only (never the edge
// secret, never the client). If it's absent (e.g. not yet set in Vercel), we degrade to
// 503 search_unavailable so the UI can say search isn't available — no crash.
//
// Call shape mirrors M1's supabase/functions/generate-plan/google-places.ts exactly:
// same endpoint, X-Goog-Api-Key + X-Goog-FieldMask headers.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { googlePlaceToStop, type GooglePlace } from '@/lib/places/normalize';

export const dynamic = 'force-dynamic';

const FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.photos';

// Default search center = Kelowna (our launch city).
const DEFAULT_LAT = 49.888;
const DEFAULT_LNG = -119.496;

interface Body {
  query?: unknown;
  lat?: unknown;
  lng?: unknown;
  radiusKm?: unknown;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'search_unavailable' }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

  const lat = typeof body.lat === 'number' ? body.lat : null;
  const lng = typeof body.lng === 'number' ? body.lng : null;
  const radiusKm = typeof body.radiusKm === 'number' && body.radiusKm > 0 ? body.radiusKm : 25;

  const payload: Record<string, unknown> = { textQuery: query, maxResultCount: 12 };
  // Bias to a center when we have one; default to Kelowna otherwise.
  const center = lat !== null && lng !== null
    ? { latitude: lat, longitude: lng }
    : { latitude: DEFAULT_LAT, longitude: DEFAULT_LNG };
  payload.locationBias = { circle: { center, radius: radiusKm * 1000 } };

  let res: Response;
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return NextResponse.json({ error: 'search_failed' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: 'search_failed' }, { status: 502 });
  }

  const json = (await res.json()) as { places?: GooglePlace[] };
  const results = (json.places ?? []).map(googlePlaceToStop);
  return NextResponse.json({ results });
}
