// apps/web/app/api/offers/notify-offered/route.ts
//
// Server-side trigger for the offer-received email. The offer itself is created
// browser → match-make-offer edge function (lib/after5/match.ts makeOffer); that
// edge runtime cannot send email (blank RESEND_API_KEY). On a successful 'offer'
// result the host's client POSTs { offerId } here so the send runs in the Node
// runtime where RESEND_API_KEY / SUPABASE_SECRET_KEY actually exist.
//
// Best-effort by contract: always 200s with { sent, skipped? }. A miss never
// signals failure to the caller — the offer RPC already succeeded and is the
// source of truth. Auth is the viewer's SSR session, and we verify the caller
// is the offer's creator so a user can only fire mail for offers they made.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendOfferReceivedEmail } from '@/lib/email/send-offer-received';

export const runtime = 'nodejs';

interface Body { offerId?: unknown }

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let body: Body;
  try { body = (await request.json()) as Body; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const offerId = typeof body.offerId === 'string' ? body.offerId.trim() : '';
  if (!offerId) return NextResponse.json({ error: 'offerId_required' }, { status: 400 });

  // Ownership check under the caller's RLS-bound client: only the offer's
  // creator may trigger its email. A miss here is not an error to the offer —
  // we no-op silently so a stale/foreign id never leaks existence or blocks.
  const { data: owned } = await supabase
    .from('offers')
    .select('id')
    .eq('id', offerId)
    .eq('creator_id', user.id)
    .maybeSingle();
  if (!owned) return NextResponse.json({ sent: false, skipped: 'not_offer_creator' });

  const result = await sendOfferReceivedEmail(offerId);
  return NextResponse.json(result);
}
