// Post-date feedback email — sent ~24h after a user's saved plan date.
// Same warm-cream brand as the welcome + weekly digest emails.
// Links to /feedback/[token] which works without auth.

import { makeFeedbackToken } from './feedback-token';
import { makeUnsubToken } from './unsubscribe-token';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

export interface PostDateEmailInput {
  savedPlanId: string;
  itineraryId: string;
  email: string;
  firstName: string | null;
  dateTitle: string;
  coverImageUrl: string | null;
}

export interface RenderedPostDateEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderPostDateFeedbackEmail(
  input: PostDateEmailInput,
): RenderedPostDateEmail {
  const greeting = input.firstName ? `Hey ${input.firstName}` : 'Hey';
  const token = makeFeedbackToken({
    savedPlanId: input.savedPlanId,
    itineraryId: input.itineraryId,
    email: input.email,
  });
  const feedbackUrl = `${SITE_URL}/feedback/${token}`;
  const unsubToken = makeUnsubToken(input.email);
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${unsubToken}`;
  const title = escapeHtml(input.dateTitle);

  const coverHtml = input.coverImageUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
        <tr>
          <td align="center">
            <img src="${escapeHtml(input.coverImageUrl)}"
                 width="460" height="230" alt="${title}"
                 style="display:block;width:100%;max-width:460px;height:auto;border-radius:12px;border:1px solid #E8DFCB;" />
          </td>
        </tr>
      </table>`
    : '';

  const subject = `How was "${input.dateTitle}"?`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(subject)}</title>
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
            <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E8DFCB;border-radius:18px;padding:32px 28px;">
              <p style="margin:0 0 10px 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8B8884;">
                How&rsquo;d it go?
              </p>

              <h1 style="margin:0 0 16px 0;font-family:'Inter',sans-serif;font-size:26px;font-weight:700;line-height:1.15;letter-spacing:-0.02em;color:#1A1A1A;">
                ${greeting} &mdash; how was <em style="font-style:italic;font-weight:600;color:#C2552B;">${title}</em>?
              </h1>

              <p style="margin:0 0 24px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#6B6864;">
                Your date was yesterday &mdash; hope it was a good one. A quick review (3 taps, 30 seconds) helps us build better plans for everyone in Kelowna.
              </p>

              ${coverHtml}

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td bgcolor="#1A1A1A" style="background-color:#1A1A1A;border-radius:9999px;">
                    <a class="btn" href="${feedbackUrl}" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:'Inter',sans-serif;font-size:15px;font-weight:600;color:#FDF9F3;text-decoration:none;border-radius:9999px;">
                      Rate your date &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.6;color:#8B8884;">
                No login needed &mdash; just tap and go.
              </p>

              <hr style="border:none;border-top:1px solid #E8DFCB;margin:26px 0 22px 0;">

              <p style="margin:0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.6;color:#1A1A1A;">
                Thanks for using After5,<br>Lucas
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 8px 0 8px;">
              <p style="margin:0 0 6px 0;font-family:'Inter',sans-serif;font-size:11px;line-height:1.6;color:#8B8884;">
                <a href="${SITE_URL}" style="color:#1A1A1A;text-decoration:underline;">tryafter5.app</a>
                &middot; Curated date plans for Kelowna couples
              </p>
              <p style="margin:0;font-family:'Inter',sans-serif;font-size:11px;line-height:1.6;color:#8B8884;">
                Don&rsquo;t want post-date emails? <a href="${unsubUrl}" style="color:#8B8884;text-decoration:underline;">Unsubscribe</a> &mdash; one click.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting} -- how was "${input.dateTitle}"?

Your date was yesterday -- hope it was a good one. A quick review (3 taps, 30 seconds) helps us build better plans for everyone in Kelowna.

Rate your date: ${feedbackUrl}

No login needed -- just tap and go.

Thanks for using After5,
Lucas

----------
tryafter5.app -- Curated date plans for Kelowna couples
Don't want post-date emails? Unsubscribe: ${unsubUrl}`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
