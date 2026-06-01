// apps/web/lib/email/send-offer-expiring.ts
//
// Server-only dispatcher: given an open offer id, resolve the candidate and
// fire the offer-expiring reminder email via the best-effort Resend wrapper.
// Runs server-side ONLY — that's where RESEND_API_KEY / RESEND_FROM_EMAIL /
// SUPABASE_SECRET_KEY live (the match edge runtime has a BLANK Resend key, so
// email cannot be sent from there). Mirrors send-offer-received.ts.
//
// Best-effort by contract: this function NEVER throws. A missing-config /
// lookup-miss / send-failure returns a { sent:false, skipped } shape and logs
// a warning so the cron sweep is never blocked on a single bad row.
//
// Recipient resolution mirrors send-offer-received.ts: profiles holds
// first_name but NOT email, so we read the candidate's address from auth.users
// via admin.auth.admin.getUserById(). The plan title comes from the offered
// night's itinerary (date_instances → itineraries.title).

import { createAdminClient } from '@/lib/supabase/admin';
import { renderOfferExpiringEmail } from '@/lib/email/offer-expiring';
import { sendEmail } from '@/lib/email/resend';

export interface SendOfferExpiringResult {
  sent: boolean;
  id?: string;
  skipped?:
    | 'offer_not_found'
    | 'no_recipient_email'
    | 'email_not_configured_or_failed'
    | 'lookup_error';
}

// Friendly time-left copy, e.g. "in about 2 hours" / "in under an hour" /
// "soon". The expiring template requires a non-empty label, so we always
// return a string. Best-effort: any parse trouble falls back to "soon".
export function timeLeftLabel(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!expiresAt) return 'soon';
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return 'soon';
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return 'any minute now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return 'in under an hour';
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'in about an hour';
  return `in about ${hours} hours`;
}

export async function sendOfferExpiringEmail(
  offerId: string,
): Promise<SendOfferExpiringResult> {
  if (!offerId || typeof offerId !== 'string') {
    console.warn('[offer-expiring-email] missing offerId — skip send');
    return { sent: false, skipped: 'offer_not_found' };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.warn('[offer-expiring-email] admin client unavailable — skip send', err);
    return { sent: false, skipped: 'email_not_configured_or_failed' };
  }

  try {
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
      console.warn('[offer-expiring-email] offer lookup failed — skip send', error.message);
      return { sent: false, skipped: 'lookup_error' };
    }
    if (!offer) {
      console.warn('[offer-expiring-email] offer not found — skip send', offerId);
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
      console.warn(
        '[offer-expiring-email] no recipient email — skip send',
        offer.candidate_id,
        authErr?.message,
      );
      return { sent: false, skipped: 'no_recipient_email' };
    }
    const to = authRes.user.email;

    const fromName = host?.first_name?.trim() || 'someone';
    const planTitle = instance?.itinerary?.title?.trim() || 'a night out';

    const rendered = renderOfferExpiringEmail({
      email: to,
      firstName: candidate?.first_name ?? null,
      fromName,
      planTitle,
      expiresLabel: timeLeftLabel(offer.expires_at),
      offerPath: `/offers/${offerId}`,
    });

    const result = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'offer_expiring',
    });

    if (!result) {
      return { sent: false, skipped: 'email_not_configured_or_failed' };
    }
    return { sent: true, id: result.id };
  } catch (err) {
    console.warn('[offer-expiring-email] unexpected error — skip send', err);
    return { sent: false, skipped: 'lookup_error' };
  }
}
