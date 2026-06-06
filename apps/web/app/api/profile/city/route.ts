import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { enqueueSeedCity } from '@/lib/after5/enqueue-seed-city';

// POST /api/profile/city — the only caller that writes profiles.primary_city_id.
//
// A signed-in user picks/confirms their curated city in the generate funnel; this
// route writes primary_city_id under the RLS-bound server client (.eq('id',
// user.id) → profiles_owner_all self-update; NO admin client for the write) and
// then fires enqueueSeedCity(cityId) fire-and-forget to warm the city's corpus.
//
// Secure-by-default (T-10-03/04/06):
//  - createClient().auth.getUser() → 401 on anon; the write can only target the
//    caller's own row, so a user can never set another's primary_city_id.
//  - cityId is zod-uuid validated AND must reference an active curated city before
//    the write — a hostile/unknown id returns 400 and never reaches the FK write.
//  - the enqueue stays in the admin-context helper (enqueue_job is REVOKED from
//    authenticated); never exposed to the browser.
//
// Fire-and-forget posture: a slow/failing enqueue NEVER fails the request (logged
// .catch), so the city save mirrors the email-notification side-effect posture and
// a cold city never blocks generation.

const BodySchema = z.object({ cityId: z.string().uuid() });

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_city_id' }, { status: 400 });
  }
  const { cityId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // The cityId must reference an active curated city before we write the FK.
  const { data: city } = await supabase
    .from('cities')
    .select('id')
    .eq('id', cityId)
    .eq('is_active', true)
    .maybeSingle();
  if (!city) {
    return NextResponse.json({ error: 'unknown_city' }, { status: 400 });
  }

  // Self-scoped write under profiles_owner_all (id = auth.uid()). No admin client.
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ primary_city_id: cityId })
    .eq('id', user.id);
  if (updateError) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Fire-and-forget: warm the city in the background. A queue hiccup must never
  // fail the save, so we swallow + log rather than await into the response path.
  void Promise.resolve(enqueueSeedCity(cityId)).catch((err) => {
    console.warn('[profile/city] enqueueSeedCity failed — skip', err);
  });

  return NextResponse.json({ ok: true });
}
