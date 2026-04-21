// Toggle a plan saved/unsaved for the current user.
//   POST /api/saved-plans   { itinerary_id }   → { saved: true }   (saved)
//   DELETE /api/saved-plans { itinerary_id }   → { saved: false }  (unsaved)
//
// Both endpoints require auth. Returns 401 to logged-out callers so the
// client can surface a sign-in prompt.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface Body {
  itinerary_id?: unknown;
}

async function readBody(request: NextRequest): Promise<string | null> {
  try {
    const json = (await request.json()) as Body;
    if (typeof json.itinerary_id !== 'string') return null;
    if (!/^[0-9a-f-]{36}$/i.test(json.itinerary_id)) return null;
    return json.itinerary_id;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const itineraryId = await readBody(request);
  if (!itineraryId) {
    return NextResponse.json({ error: 'itinerary_id required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { error } = await supabase
    .from('saved_plans')
    .upsert(
      { user_id: user.id, itinerary_id: itineraryId },
      { onConflict: 'user_id,itinerary_id', ignoreDuplicates: true },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}

export async function DELETE(request: NextRequest) {
  const itineraryId = await readBody(request);
  if (!itineraryId) {
    return NextResponse.json({ error: 'itinerary_id required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { error } = await supabase
    .from('saved_plans')
    .delete()
    .eq('user_id', user.id)
    .eq('itinerary_id', itineraryId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: false });
}
