import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Captures emails from the plan flow gate. Idempotent on (email, source) so
// repeat submissions don't fail. Returns 200 either way to avoid leaking
// "this email exists" signal.

export async function POST(req: Request) {
  let body: {
    email?: string;
    location?: string;
    source?: string;
    itinerary_id?: string;
    itinerary_ids?: string[];
    city?: string | null;
    first_name?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const city = body.city ? body.city.trim().slice(0, 80) : null;
  const firstName = body.first_name ? body.first_name.trim().slice(0, 40) : null;

  // Service-role client — bypasses RLS so the upsert can update existing
  // rows on the second/third email-gate substep. Validation above covers
  // the abuse vectors that RLS would otherwise block.
  const supabase = createAdminClient();
  const userAgent = req.headers.get('user-agent') ?? null;

  const { error } = await supabase.from('subscribers').upsert(
    {
      email,
      source: body.source ?? 'plan_gate',
      location: body.location ?? null,
      itinerary_id: body.itinerary_id ?? null,
      city,
      first_name: firstName,
      user_agent: userAgent,
    },
    { onConflict: 'email,source', ignoreDuplicates: false },
  );

  if (error) {
    console.error('subscribe error', error);
  }

  // Attribute the just-generated itineraries with the user's first name +
  // neighborhood. Powers the social-proof toast ("Sarah from Glenmore built
  // a date 2 hours ago"). Only write fields we actually have.
  const ids = body.itinerary_ids ?? (body.itinerary_id ? [body.itinerary_id] : []);
  if (ids.length > 0 && (firstName || city)) {
    const patch: { built_by_name?: string; built_by_neighborhood?: string } = {};
    if (firstName) patch.built_by_name = firstName;
    if (city) patch.built_by_neighborhood = city;
    const { error: attrErr } = await supabase.from('itineraries')
      .update(patch)
      .in('id', ids);
    if (attrErr) console.error('attribution error', attrErr);
  }

  return NextResponse.json({ ok: true });
}
