// Welcome email content + send. Fired from /auth/callback the first time
// a brand-new email lands (no prior subscriber row).

import { sendEmail } from './resend';
import { emailShell, eyebrow, ctaButton, BRAND, FONT_BODY, FONT_HEADING } from './layout';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';
// Polaroid PNGs live in Supabase storage (not the web public folder) so they
// don't depend on a Vercel deploy being live before we can ship an email.
// Source composer: apps/web/scripts/compose-polaroids.mjs.
const EMAIL_ASSETS =
  'https://ufufmcpnysvwtutpbian.supabase.co/storage/v1/object/public/itinerary-covers/email';

export async function sendWelcomeEmail(opts: { to: string; firstName?: string | null }) {
  const greeting = opts.firstName ? `hey ${escapeHtml(opts.firstName)}` : 'hey';

  // Polaroid composition — pre-rendered PNGs with the tilt + frame + caption
  // baked into pixels. Gmail web strips CSS transform:rotate, so shipping
  // tilted divs doesn't work. PNGs render everywhere. The polaroid motif is a
  // brand keeper (DESIGN-SYSTEM §5). Source: apps/web/scripts/compose-polaroids.mjs.
  const polaroids = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px 0;">
        <tr>
          <td align="center" valign="middle" style="padding:8px 0;">
            <img class="pol-1" src="${EMAIL_ASSETS}/polaroid-west-kelowna.png"
                 width="202" height="275" alt="two people on a trail above the lake"
                 style="display:inline-block;width:202px;height:275px;border:0;outline:0;margin-right:-55px;vertical-align:middle;">
            <img class="pol-2" src="${EMAIL_ASSETS}/polaroid-lakeside.png"
                 width="181" height="246" alt="two people by the lake at golden hour"
                 style="display:inline-block;width:181px;height:246px;border:0;outline:0;margin-left:-55px;margin-top:34px;vertical-align:middle;">
          </td>
        </tr>
      </table>`;

  const cardBody = `
    ${eyebrow('you&rsquo;re in', BRAND.accent)}

    <h1 style="margin:0 0 16px 0;font-family:${FONT_HEADING};font-size:34px;font-weight:400;line-height:1.05;color:${BRAND.ink};">
      ${greeting} &mdash; welcome to <span style="color:${BRAND.accent};">after5</span>.
    </h1>

    <p style="margin:0 0 24px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      i&rsquo;m lucas. i built after5 because deciding where to take someone shouldn&rsquo;t eat 40 minutes and half the night.
    </p>

    ${polaroids}

    <p style="margin:0 0 14px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      what you can do right now:
    </p>

    <ul style="margin:0 0 24px 0;padding-left:18px;font-family:${FONT_BODY};font-size:15px;line-height:1.7;color:${BRAND.ink};">
      <li><strong>plan a date</strong> &mdash; 5 questions, 30 seconds, 3 real plans.</li>
      <li><strong>save what you love</strong> &mdash; tap the heart; it lives in your dashboard.</li>
      <li><strong>browse the catalog</strong> &mdash; every plan someone&rsquo;s built is at /dates.</li>
    </ul>

    ${ctaButton({ href: `${SITE_URL}/plan`, label: 'plan tonight &rarr;' })}

    <p style="margin:16px 0 8px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.muted};">
      two things to know:
    </p>
    <p style="margin:0 0 8px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.muted};">
      1. you&rsquo;re one of the first 100, so after5 stays free for you &mdash; every future feature included.
    </p>
    <p style="margin:0 0 24px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.muted};">
      2. one person built this (me), so things will break. spot anything wrong &mdash; a closed spot, a bad photo, a dead button &mdash; reply here or hit <a href="${SITE_URL}/tell-us" style="color:${BRAND.accent};text-decoration:underline;">tryafter5.app/tell-us</a>. i read every note.
    </p>

    <p style="margin:24px 0 0 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      later,<br>
      lucas (the ai guy) senechal
    </p>
    <p style="margin:20px 0 0 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.muted};">
      <strong style="color:${BRAND.ink};">p.s.</strong> know a spot that isn&rsquo;t on after5 yet? send it to <a href="${SITE_URL}/tell-us" style="color:${BRAND.accent};text-decoration:underline;">tryafter5.app/tell-us</a> &mdash; i add them by hand, one at a time.
    </p>`;

  const html = emailShell({
    title: 'welcome to after5',
    preheader: 'your first-100 spot is locked in',
    body: cardBody,
    siteUrl: SITE_URL,
    maxWidth: 600,
    // Mobile polaroid sizing lives in the shared <style>; inject the extra rule.
    // (emailShell keeps the base styles; polaroid @media added below.)
  }).replace(
    'a.btn:hover { background-color: #C71778 !important; }',
    `a.btn:hover { background-color: #C71778 !important; }
    @media only screen and (max-width: 480px) {
      .pol-1 { width: 138px !important; height: 188px !important; margin-right: -38px !important; }
      .pol-2 { width: 122px !important; height: 166px !important; margin-left: -38px !important; margin-top: 24px !important; }
    }`,
  );

  const text = `${greeting} — welcome to after5.

i'm lucas. i built after5 because deciding where to take someone shouldn't eat 40 minutes and half the night.

what you can do right now:
- plan a date: 5 questions, 30 seconds, 3 real plans → ${SITE_URL}/plan
- save what you love: tap the heart; it lives in your dashboard
- browse the catalog: ${SITE_URL}/dates

two things to know:
1. you're one of the first 100, so after5 stays free for you — every future feature included.
2. one person built this (me), so things will break. spot anything wrong, reply here or hit ${SITE_URL}/tell-us. i read every note.

later,
lucas (the ai guy) senechal

p.s. know a spot that isn't on after5 yet? send it to ${SITE_URL}/tell-us — i add them by hand, one at a time.`;

  return sendEmail({
    to: opts.to,
    subject: 'welcome to after5 — your first-100 spot is locked in',
    html,
    text,
    tag: 'welcome',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Idempotent welcome send — used by both /auth/callback and /api/subscribe so
// every signup path gets exactly one welcome, regardless of which one the user
// hit first. Reads subscribers.welcome_sent_at, sends if null, sets the flag
// AFTER the send succeeds (so a transient Resend failure can be retried by the
// next signup-path call).
//
// admin: a service-role Supabase client. Caller passes one in to avoid an
// extra createAdminClient() per request.
export async function ensureWelcomeSent(opts: {
  email: string;
  firstName?: string | null;
  admin: { from: (t: string) => unknown };
}): Promise<{ skipped?: string; sent?: boolean; error?: string }> {
  const email = opts.email.toLowerCase().trim();
  if (!email) return { skipped: 'no_email' };

  // Cast to avoid pulling Database types into this module — it's a thin
  // wrapper around two columns we know exist.
  const subs = opts.admin.from('subscribers') as {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        not: (col: string, op: string, val: unknown) => {
          limit: (n: number) => Promise<{ data: { id: string }[] | null }>;
        };
        limit: (n: number) => Promise<{ data: { id: string; welcome_sent_at: string | null }[] | null }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };

  const { data } = await subs
    .select('id, welcome_sent_at')
    .eq('email', email)
    .limit(1);
  const row = data?.[0];
  if (!row) return { skipped: 'no_subscriber_row' };
  if (row.welcome_sent_at) return { skipped: 'already_sent' };

  const sent = await sendWelcomeEmail({ to: email, firstName: opts.firstName });
  if (!sent) return { error: 'send_failed' };

  const { error } = await subs.update({ welcome_sent_at: new Date().toISOString() }).eq('id', row.id);
  if (error) {
    // Email went out but flag wasn't set — log so we don't blast on retry.
    console.error('[welcome] flag write failed (sent but not flagged)', error.message);
  }
  return { sent: true };
}
