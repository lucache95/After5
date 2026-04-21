import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Anonymous vote. Voter token is supplied by the client (random ID stored
// in localStorage). One vote per voter per session via UNIQUE constraint.

export async function POST(req: Request) {
  let body: {
    session_id?: string;
    itinerary_id?: string;
    voter_token?: string;
    voter_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const sid = body.session_id;
  const iid = body.itinerary_id;
  const token = body.voter_token;
  if (!sid || !/^[0-9a-f-]{36}$/i.test(sid)) return NextResponse.json({ error: 'bad_session' }, { status: 400 });
  if (!iid || !/^[0-9a-f-]{36}$/i.test(iid)) return NextResponse.json({ error: 'bad_itinerary' }, { status: 400 });
  if (!token || token.length < 8 || token.length > 64) return NextResponse.json({ error: 'bad_token' }, { status: 400 });

  const supabase = await createClient();
  // Upsert on (session_id, voter_token) so re-voting overwrites.
  const { error } = await (supabase.from('plan_votes') as any).upsert(
    {
      session_id: sid,
      itinerary_id: iid,
      voter_token: token,
      voter_name: body.voter_name?.slice(0, 40) ?? null,
    },
    { onConflict: 'session_id,voter_token' },
  );

  if (error) {
    console.error('vote insert error', error);
    return NextResponse.json({ error: 'vote_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
