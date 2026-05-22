// Insider welcome email — sent when an application is approved.
// Same warm-cream branded pattern as welcome.ts and post-date-feedback.ts.

import { sendEmail } from './resend';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

const ROLE_DESCRIPTIONS: Record<string, string> = {
  scout:
    'As a Scout, you discover hidden gems and report back on new spots around Kelowna. Your finds help every couple in town plan better dates.',
  tester:
    'As a Tester, you go on After5 dates and give honest feedback. Your reviews help us keep the quality bar high.',
  curator:
    'As a Curator, you write and polish venue descriptions, vibes, and local insights. Your words make every date plan feel personal.',
  ambassador:
    'As an Ambassador, you spread the word and represent After5 in your community. You are the face of better dates in Kelowna.',
};

export async function sendInsiderWelcomeEmail(opts: {
  to: string;
  firstName: string | null;
  role: string;
}) {
  const greeting = opts.firstName ? `Hey ${opts.firstName}` : 'Hey';
  const roleLabel = opts.role.charAt(0).toUpperCase() + opts.role.slice(1);
  const roleDesc =
    ROLE_DESCRIPTIONS[opts.role] ?? 'You are now an official After5 Insider.';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Welcome to After5 Insiders</title>
  <style>
    body, table, td, p, a, h1, h2 { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    a.btn:hover { background-color: #2a2a2a !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#FDF9F3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF9F3" style="background-color:#FDF9F3;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

          <tr>
            <td align="left" style="padding:0 0 28px 0;">
              <a href="${SITE_URL}" style="font-family:'Inter',sans-serif;font-size:20px;font-weight:700;color:#1A1A1A;text-decoration:none;letter-spacing:-0.01em;">After5</a>
            </td>
          </tr>

          <tr>
            <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E8DFCB;border-radius:18px;padding:36px 32px;">
              <p style="margin:0 0 10px 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8B8884;">
                You&rsquo;re in
              </p>

              <h1 style="margin:0 0 16px 0;font-family:'Inter',sans-serif;font-size:28px;font-weight:700;line-height:1.15;letter-spacing:-0.02em;color:#1A1A1A;">
                ${greeting} &mdash; welcome to <em style="font-style:italic;font-weight:600;color:#C2552B;">After5 Insiders</em>.
              </h1>

              <p style="margin:0 0 20px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#1A1A1A;">
                Your application has been approved. You&rsquo;re officially part of the team that shapes the best date experiences in Kelowna.
              </p>

              <!-- Role badge -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="background-color:#FDF0E9;border:1px solid #E8DFCB;border-radius:12px;padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#C2552B;">
                      Your role
                    </p>
                    <p style="margin:0 0 8px 0;font-family:'Inter',sans-serif;font-size:20px;font-weight:700;color:#1A1A1A;">
                      ${roleLabel}
                    </p>
                    <p style="margin:0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.5;color:#6B6864;">
                      ${roleDesc}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#6B6864;">
                Head to your Insider dashboard to see your first tasks and start earning points. The leaderboard is waiting.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td bgcolor="#1A1A1A" style="background-color:#1A1A1A;border-radius:9999px;">
                    <a class="btn" href="${SITE_URL}/insiders" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:'Inter',sans-serif;font-size:15px;font-weight:600;color:#FDF9F3;text-decoration:none;border-radius:9999px;">
                      Open your dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #E8DFCB;margin:26px 0 22px 0;">

              <p style="margin:0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#1A1A1A;">
                Glad to have you on the team,<br>Lucas
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 8px 0 8px;">
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

  const text = `${greeting} -- welcome to After5 Insiders.

Your application has been approved. You're officially part of the team that shapes the best date experiences in Kelowna.

Your role: ${roleLabel}
${roleDesc}

Head to your Insider dashboard to see your first tasks and start earning points:
${SITE_URL}/insiders

Glad to have you on the team,
Lucas

----------
tryafter5.app -- Curated date plans for Kelowna couples`;

  return sendEmail({
    to: opts.to,
    subject: `Welcome to After5 Insiders -- you're a ${roleLabel}`,
    html,
    text,
    tag: 'insider-welcome',
  });
}
