// Welcome email content + send. Fired from /auth/callback the first time
// a brand-new email lands (no prior subscriber row).

import { sendEmail } from './resend';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';
// Polaroid PNGs live in Supabase storage (not the web public folder) so they
// don't depend on a Vercel deploy being live before we can ship an email.
// Source composer: apps/web/scripts/compose-polaroids.mjs.
const EMAIL_ASSETS =
  'https://ufufmcpnysvwtutpbian.supabase.co/storage/v1/object/public/itinerary-covers/email';

export async function sendWelcomeEmail(opts: { to: string; firstName?: string | null }) {
  const greeting = opts.firstName ? `Hey ${opts.firstName}` : 'Hey';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Welcome to After5</title>
  <style>
    body, table, td, p, a, h1, h2 { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    a.btn:hover { background-color: #2a2a2a !important; }
    /* Mobile polaroid sizing — Outlook desktop ignores @media (Word renderer)
       and shows the desktop dimensions, which is acceptable degradation. */
    @media only screen and (max-width: 480px) {
      .pol-1 { width: 138px !important; height: 188px !important; margin-right: -38px !important; }
      .pol-2 { width: 122px !important; height: 166px !important; margin-left:  -38px !important; margin-top: 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#FDF9F3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF9F3" style="background-color:#FDF9F3;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

          <tr>
            <td align="left" style="padding:0 0 36px 0;">
              <a href="${SITE_URL}" style="font-family:'Inter',sans-serif;font-size:20px;font-weight:700;color:#1A1A1A;text-decoration:none;letter-spacing:-0.01em;">After5</a>
            </td>
          </tr>

          <tr>
            <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E8DFCB;border-radius:18px;padding:36px 32px;">
              <p style="margin:0 0 12px 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8B8884;">
                You&rsquo;re in
              </p>

              <h1 style="margin:0 0 16px 0;font-family:'Inter',sans-serif;font-size:30px;font-weight:700;line-height:1.1;letter-spacing:-0.02em;color:#1A1A1A;">
                ${greeting} &mdash; welcome to <em style="font-style:italic;font-weight:600;color:#C2552B;">After5</em>.
              </h1>

              <p style="margin:0 0 24px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#1A1A1A;">
                I&rsquo;m Lucas. I built After5 because I was tired of spending 40 minutes
                deciding where to take my partner before half the spots closed.
              </p>

              <!-- Polaroid composition — pre-rendered PNGs with the tilt +
                   frame + caption baked into pixels. Gmail web strips CSS
                   transform:rotate, so shipping tilted divs doesn't work. PNGs
                   render correctly everywhere (Apple Mail / Gmail / Outlook).
                   Source script: apps/web/scripts/compose-polaroids.mjs. -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px 0;">
                <tr>
                  <td align="center" valign="middle" style="padding:8px 0;">
                    <img class="pol-1" src="${EMAIL_ASSETS}/polaroid-west-kelowna.png"
                         width="202" height="275" alt="Couple on a trail above Okanagan Lake"
                         style="display:inline-block;width:202px;height:275px;border:0;outline:0;margin-right:-55px;vertical-align:middle;">
                    <img class="pol-2" src="${EMAIL_ASSETS}/polaroid-lakeside.png"
                         width="181" height="246" alt="Couple at Okanagan Lake"
                         style="display:inline-block;width:181px;height:246px;border:0;outline:0;margin-left:-55px;margin-top:34px;vertical-align:middle;">
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#6B6864;">
                Here&rsquo;s what you can do right now:
              </p>

              <ul style="margin:0 0 24px 0;padding-left:18px;font-family:'Inter',sans-serif;font-size:15px;line-height:1.7;color:#1A1A1A;">
                <li><strong>Plan a date</strong> &mdash; 5 questions, 30 seconds, 3 real plans.</li>
                <li><strong>Save what you love</strong> &mdash; tap the heart on any plan; it lives in your dashboard.</li>
                <li><strong>Browse the catalog</strong> &mdash; every plan a Kelownan&rsquo;s built is at /dates.</li>
              </ul>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td bgcolor="#1A1A1A" style="background-color:#1A1A1A;border-radius:9999px;">
                    <a class="btn" href="${SITE_URL}/plan" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:'Inter',sans-serif;font-size:15px;font-weight:600;color:#FDF9F3;text-decoration:none;border-radius:9999px;">
                      Plan tonight &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                Two things to know:
              </p>
              <p style="margin:0 0 8px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                1. You&rsquo;re one of the first 100. That means After5 stays free for you, forever &mdash; every future feature included.
              </p>
              <p style="margin:0 0 24px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                2. This is built by one person (me). Things will break. If you spot anything wrong &mdash; a closed restaurant, a bad photo, a button that doesn&rsquo;t work &mdash; reply to this email or hit <a href="${SITE_URL}/tell-us" style="color:#C2552B;text-decoration:underline;">tryafter5.app/tell-us</a>. I read every note.
              </p>

              <p style="margin:24px 0 0 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#1A1A1A;">
                Have a good night out,<br>
                Lucas (the ai guy) Senechal
              </p>
              <p style="margin:20px 0 0 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                <strong style="color:#1A1A1A;">P.S.</strong> Know a Kelowna spot that isn&rsquo;t on After5 yet? Send it to me at <a href="${SITE_URL}/tell-us" style="color:#C2552B;text-decoration:underline;">tryafter5.app/tell-us</a> &mdash; I add them by hand, one at a time.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 8px 0 8px;">
              <p style="margin:0;font-family:'Inter',sans-serif;font-size:12px;line-height:1.6;color:#8B8884;">
                <a href="${SITE_URL}" style="color:#1A1A1A;text-decoration:underline;">tryafter5.app</a>
                &middot; Curated date plans for Kelowna couples
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${greeting} — welcome to After5.

I'm Lucas. I built After5 because I was tired of spending 40 minutes deciding where to take my partner before half the spots closed.

Here's what you can do right now:
- Plan a date: 5 questions, 30 seconds, 3 real plans → ${SITE_URL}/plan
- Save what you love: tap the heart on any plan; it lives in your dashboard
- Browse the catalog: ${SITE_URL}/dates

Two things to know:
1. You're one of the first 100. After5 stays free for you, forever — every future feature included.
2. This is built by one person (me). Things will break. If you spot anything wrong, reply to this email or hit ${SITE_URL}/tell-us. I read every note.

Have a good night out,
Lucas (the ai guy) Senechal

P.S. Know a Kelowna spot that isn't on After5 yet? Send it to me at ${SITE_URL}/tell-us — I add them by hand, one at a time.`;

  return sendEmail({
    to: opts.to,
    subject: 'Welcome to After5 — your first 100 spot is locked in.',
    html,
    text,
    tag: 'welcome',
  });
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
