// apps/web/lib/email/send-offer-received.ts
//
// Server-only dispatcher: given a freshly-created offer id, resolve the
// recipient (the candidate) and fire the offer-received email via the
// best-effort Resend wrapper. Runs server-side ONLY — that's where
// RESEND_API_KEY / RESEND_FROM_EMAIL / SUPABASE_SECRET_KEY live (the
// match-make-offer edge runtime has a BLANK Resend key, so email cannot
// be sent from there; see route /api/offers/email header note).
//
// Best-effort by contract: this function NEVER throws. The offer RPC
// succeeding is the source of truth; a missing-config / lookup-miss /
// send-failure returns a { sent:false, skipped } shape and logs a warning
// so the offer flow is never blocked. Mirrors lib/email/resend.ts.
//
// Recipient resolution mirrors the existing email paths (welcome.ts uses a
// service-role admin client): profiles holds first_name but NOT email, so we
// read the candidate's address from auth.users via admin.auth.admin
// .getUserById(). The plan title comes from the offered night's itinerary
// (date_instances → itineraries.title), the same embed the reciprocal page uses.

import { createAdminClient } from '@/lib/supabase/admin';
import { renderOfferReceivedEmail } from '@/lib/email/offer-received';
import { sendEmail } from '@/lib/email/resend';

export interface SendOfferReceivedResult {
  sent: boolean;
  id?: string;
  skipped?:
    | 'offer_not_found'
    | 'no_recipient_email'
    | 'email_not_configured_or_failed'
    | 'lookup_error';
}

// Friendly expiry copy, e.g. "Fri, 6:00 PM". Best-effort: any parse trouble
// just drops the label (the template treats expiresLabel as optional).
function expiresLabel(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export async function sendOfferReceivedEmail(
  offerId: string,
): Promise<SendOfferReceivedResult> {
  if (!offerId || typeof offerId !== 'string') {
    console.warn('[offer-email] missing offerId — skip send');
    return { sent: false, skipped: 'offer_not_found' };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    // SUPABASE_SECRET_KEY / URL missing — log and no-op, never block the offer.
    console.warn('[offer-email] admin client unavailable — skip send', err);
    return { sent: false, skipped: 'email_not_configured_or_failed' };
  }

  try {
    // One read resolves everything the template needs: the candidate (recipient
    // profile), the host (sender display name), and the offered night's plan.
    const { data: offer, error } = await admin
      .from('offers')
      .select(
        `expires_at, candidate_id,
         candidate:profiles!offers_candidate_id_fkey ( first_name ),
         host:profiles!offers_creator_id_fkey ( first_name ),
         instance:date_instances!offers_date_instance_id_fkey (
           itinerary:itineraries ( title )
         )`,
      )
      .eq('id', offerId)
      .maybeSingle();

    if (error) {
      console.warn('[offer-email] offer lookup failed — skip send', error.message);
      return { sent: false, skipped: 'lookup_error' };
    }
    if (!offer) {
      console.warn('[offer-email] offer not found — skip send', offerId);
      return { sent: false, skipped: 'offer_not_found' };
    }

    // PostgREST returns embedded to-one rows as objects (or null). Normalize.
    const candidate = (offer.candidate ?? null) as { first_name?: string | null } | null;
    const host = (offer.host ?? null) as { first_name?: string | null } | null;
    const instance = (offer.instance ?? null) as {
      itinerary?: { title?: string | null } | null;
    } | null;

    // Recipient email lives in auth.users — read it service-role by user id.
    const { data: authRes, error: authErr } = await admin.auth.admin.getUserById(
      offer.candidate_id,
    );
    if (authErr || !authRes?.user?.email) {
      console.warn('[offer-email] no recipient email — skip send', offer.candidate_id, authErr?.message);
      return { sent: false, skipped: 'no_recipient_email' };
    }
    const to = authRes.user.email;

    const fromName = host?.first_name?.trim() || 'someone';
    const planTitle = instance?.itinerary?.title?.trim() || 'a night out';

    const rendered = renderOfferReceivedEmail({
      email: to,
      firstName: candidate?.first_name ?? null,
      fromName,
      planTitle,
      expiresLabel: expiresLabel(offer.expires_at),
      offerPath: `/offers/${offerId}`,
    });

    const result = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'offer_received',
    });

    if (!result) {
      // sendEmail already logged the reason (missing creds or Resend failure).
      return { sent: false, skipped: 'email_not_configured_or_failed' };
    }
    return { sent: true, id: result.id };
  } catch (err) {
    // Belt-and-suspenders: any unexpected throw must not surface to the offer.
    console.warn('[offer-email] unexpected error — skip send', err);
    return { sent: false, skipped: 'lookup_error' };
  }
}
