import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Anonymous feedback capture. Three signals from the post-results pulse:
//   stop_votes      — array of {stop_idx, vote: 'up'|'down'}
//   skip_stop_idx   — single stop index the user would drop
//   would_do        — 'yes' | 'maybe' | 'no'
// Idempotent best-effort. We never block the user on this; if it fails,
// they don't even know.

interface Body {
  itinerary_id?: string;
  source?: string;
  stop_votes?: Array<{ stop_idx: number; vote: 'up' | 'down' }>;
  skip_stop_idx?: number | null;
  would_do?: 'yes' | 'maybe' | 'no' | null;
  notes?: string | null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.itinerary_id || !/^[0-9a-f-]{36}$/i.test(body.itinerary_id)) {
    return NextResponse.json({ error: 'invalid_itinerary_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const userAgent = req.headers.get('user-agent') ?? null;

  // Cast: generated DB types don't yet include plan_feedback.
  const { error } = await (supabase.from('plan_feedback') as any).insert({
    itinerary_id: body.itinerary_id,
    source: body.source ?? 'plan_results',
    stop_votes: body.stop_votes ?? null,
    skip_stop_idx: typeof body.skip_stop_idx === 'number' ? body.skip_stop_idx : null,
    would_do: body.would_do ?? null,
    notes: body.notes?.slice(0, 500) ?? null,
    user_agent: userAgent,
  });

  if (error) {
    console.error('feedback insert error', error);
    return NextResponse.json({ ok: true, persisted: false });
  }
  return NextResponse.json({ ok: true });
}
