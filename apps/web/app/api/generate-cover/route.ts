// POST /api/generate-cover — owner-gated proxy to the generate-cover edge fn.
// The edge fn requires a service-role bearer (Replicate costs money), so the
// browser can never call it directly. This route authenticates the signed-in
// user, verifies they own the itinerary, then invokes the fn server-side with
// force:true (the user explicitly asked for a cover, even if one exists).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  let body: { itinerary_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const itineraryId = body.itinerary_id;
  if (typeof itineraryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(itineraryId)) {
    return NextResponse.json({ error: 'invalid_itinerary_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: it } = await supabase
    .from('itineraries')
    .select('id,user_id')
    .eq('id', itineraryId)
    .maybeSingle();
  if (!it || it.user_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Shared-secret auth (the process-jobs pattern). The old service-role bearer
  // string-compare broke when the project moved to the new API-key system —
  // the edge runtime's injected value stopped matching any key a caller holds.
  const jobsSecret = process.env.JOBS_RUNNER_SECRET;
  if (!url || !jobsSecret) {
    return NextResponse.json({ error: 'cover generation is not configured on this server' }, { status: 500 });
  }

  const resp = await fetch(`${url}/functions/v1/generate-cover`, {
    method: 'POST',
    headers: {
      'x-jobs-secret': jobsSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ itinerary_id: itineraryId, force: true }),
  });

  const payload = await resp.json().catch(() => null) as
    | { error?: string; results?: Array<{ id: string; cover?: string; error?: string; skipped?: string }> }
    | null;

  if (!resp.ok) {
    return NextResponse.json(
      { error: payload?.error ?? `cover generation failed (${resp.status})` },
      { status: 502 },
    );
  }

  const result = payload?.results?.[0];
  if (!result?.cover) {
    return NextResponse.json(
      { error: result?.error ?? 'cover generation came back empty. try again?' },
      { status: 502 },
    );
  }

  return NextResponse.json({ cover_image_url: result.cover });
}
