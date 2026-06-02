import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureWelcomeSent } from '@/lib/email/welcome';
import { normalizeSubscribeInput, upsertSubscriber } from '@/lib/create/subscribe';

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

  const n = normalizeSubscribeInput({
    email: body.email,
    city: body.city,
    first_name: body.first_name,
    source: body.source,
  });
  if (!n.valid) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  // Service-role client — bypasses RLS so the upsert can update existing
  // rows on the second/third email-gate substep. Validation above covers
  // the abuse vectors that RLS would otherwise block.
  const supabase = createAdminClient();
  const userAgent = req.headers.get('user-agent') ?? null;

  // Idempotent upsert + itinerary attribution (claim_email + social-proof
  // fields) so /auth/callback can attach the itineraries once the magic link
  // is clicked. Shared helper — see lib/create/subscribe.ts.
  const ids = body.itinerary_ids ?? (body.itinerary_id ? [body.itinerary_id] : []);
  const { error } = await upsertSubscriber(supabase, n, {
    userAgent,
    location: body.location ?? null,
    itineraryId: body.itinerary_id ?? null,
    itineraryIds: ids,
  });

  if (error) {
    console.error('subscribe error', error);
  } else {
    // Fire welcome email asap. Idempotent — checks subscribers.welcome_sent_at,
    // skips if already sent. Non-blocking: a Resend hiccup must not fail the
    // gate flow. Runs after the response in the background via void.
    void ensureWelcomeSent({ email: n.email, firstName: n.first_name, admin: supabase }).then((res) => {
      if (res.error) console.error('[subscribe] welcome', res.error);
    });
  }

  return NextResponse.json({ ok: true });
}
