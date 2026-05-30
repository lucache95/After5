// apps/web/app/api/offers/email/route.ts
//
// Sends offer_received / offer_expiring emails via the warm-cream Barbiecore
// templates + the best-effort Resend wrapper (lib/email/resend.ts).
//
// Server-only. Designed to be called from the notification dispatch path
// (server-to-server), NOT from a browser session — so it authenticates with a
// shared secret rather than a Supabase user session. R3 wires this into the
// dispatcher; this route just validates input and renders/sends.
//
// Graceful no-op: if Resend env (RESEND_API_KEY / RESEND_FROM_EMAIL) is
// missing, sendEmail() logs and returns null — the route still 200s with
// { sent: false, skipped: 'email_not_configured' } so dispatch never blocks.
import { NextResponse, type NextRequest } from 'next/server';
import { renderOfferReceivedEmail } from '@/lib/email/offer-received';
import { renderOfferExpiringEmail } from '@/lib/email/offer-expiring';
import { sendEmail } from '@/lib/email/resend';

export const runtime = 'nodejs';

// The two NotificationType values this route renders. The full offer_* set
// (offer_withdrawn / offer_passed / offer_expired) has no recipient-facing
// email template yet — reject them explicitly so callers fail loud.
const OFFER_EMAIL_TYPES = ['offer_received', 'offer_expiring'] as const;
type OfferEmailType = (typeof OFFER_EMAIL_TYPES)[number];

interface OfferEmailBody {
  type?: unknown;
  to?: unknown;
  firstName?: unknown;
  fromName?: unknown;
  planTitle?: unknown;
  expiresLabel?: unknown;
  offerPath?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isOfferEmailType(v: unknown): v is OfferEmailType {
  return typeof v === 'string' && (OFFER_EMAIL_TYPES as readonly string[]).includes(v);
}

function asOptString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export async function POST(request: NextRequest) {
  // Shared-secret guard. If NOTIFY_DISPATCH_SECRET is set, require a matching
  // Authorization: Bearer <secret>. If it's unset (e.g. local dev), allow —
  // the route still no-ops without Resend creds, so there's nothing to leak.
  const secret = process.env.NOTIFY_DISPATCH_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (token !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let body: OfferEmailBody;
  try {
    body = (await request.json()) as OfferEmailBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!isOfferEmailType(body.type)) {
    return NextResponse.json(
      { error: 'invalid_type', allowed: OFFER_EMAIL_TYPES },
      { status: 400 },
    );
  }

  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: 'invalid_to' }, { status: 400 });
  }

  const fromName = asOptString(body.fromName);
  const planTitle = asOptString(body.planTitle);
  if (!fromName || !planTitle) {
    return NextResponse.json({ error: 'fromName_and_planTitle_required' }, { status: 400 });
  }

  const firstName = asOptString(body.firstName);
  const offerPath = asOptString(body.offerPath);
  const expiresLabel = asOptString(body.expiresLabel);

  let rendered: { subject: string; html: string; text: string };

  if (body.type === 'offer_received') {
    rendered = renderOfferReceivedEmail({
      email: to,
      firstName,
      fromName,
      planTitle,
      expiresLabel,
      offerPath,
    });
  } else {
    // offer_expiring — expiresLabel is required for a sensible nudge.
    if (!expiresLabel) {
      return NextResponse.json(
        { error: 'expiresLabel_required_for_offer_expiring' },
        { status: 400 },
      );
    }
    rendered = renderOfferExpiringEmail({
      email: to,
      firstName,
      fromName,
      planTitle,
      expiresLabel,
      offerPath,
    });
  }

  const result = await sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tag: body.type,
  });

  if (!result) {
    // Graceful no-op: missing Resend creds or a transient Resend failure.
    // Mirror resend.ts — never throw on a user-facing path.
    return NextResponse.json({ sent: false, skipped: 'email_not_configured_or_failed' });
  }

  return NextResponse.json({ sent: true, id: result.id });
}
