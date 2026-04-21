import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Creates a voting session for a batch of 3 itinerary IDs. Returns the
// session id which the client uses to build a share URL.

export async function POST(req: Request) {
  let body: { itinerary_ids?: string[]; created_by_email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const ids = (body.itinerary_ids ?? []).filter((id): id is string =>
    typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id),
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: 'no_itineraries' }, { status: 400 });
  }

  const supabase = await createClient();
  // Cast: generated DB types don't yet include vote_sessions.
  const { data, error } = await (supabase.from('vote_sessions') as any)
    .insert({
      itinerary_ids: ids,
      created_by_email: body.created_by_email ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('vote_session insert error', error);
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}
