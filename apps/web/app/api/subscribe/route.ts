import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Captures emails from the plan flow gate. Idempotent on (email, source) so
// repeat submissions don't fail. Returns 200 either way to avoid leaking
// "this email exists" signal.

export async function POST(req: Request) {
  let body: { email?: string; location?: string; source?: string; itinerary_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const supabase = await createClient();
  const userAgent = req.headers.get('user-agent') ?? null;

  // Cast: generated DB types don't yet include `subscribers` (table is newer
  // than the last `supabase gen types` run). Runtime is fine.
  const { error } = await (supabase.from('subscribers') as any).upsert(
    {
      email,
      source: body.source ?? 'plan_gate',
      location: body.location ?? null,
      itinerary_id: body.itinerary_id ?? null,
      user_agent: userAgent,
    },
    { onConflict: 'email,source', ignoreDuplicates: true },
  );

  if (error) {
    console.error('subscribe error', error);
    // Don't fail the user flow on DB errors — they came here to see dates.
    return NextResponse.json({ ok: true, persisted: false });
  }
  return NextResponse.json({ ok: true, persisted: true });
}
