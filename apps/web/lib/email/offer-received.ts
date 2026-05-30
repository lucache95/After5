// Offer-received email — fired when someone sends a user an offer for a night out.
// Same warm-cream Barbiecore brand as the welcome + post-date emails.
// Lowercase, low-pressure voice; one clear CTA into the offer.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

export interface OfferReceivedEmailInput {
  /** Recipient email — the person who received the offer. */
  email: string;
  /** Recipient's first name, if known. */
  firstName?: string | null;
  /** Display name of the person who sent the offer. */
  fromName: string;
  /** The plan/night the offer is for, e.g. "sunset paddle + tacos". */
  planTitle: string;
  /** Optional friendly expiry copy, e.g. "tomorrow at 6pm". */
  expiresLabel?: string | null;
  /** Path to open the offer, e.g. "/offers/abc123". Defaults to /offers. */
  offerPath?: string | null;
}

export interface RenderedOfferEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderOfferReceivedEmail(
  input: OfferReceivedEmailInput,
): RenderedOfferEmail {
  const greeting = input.firstName ? `hey ${escapeText(input.firstName)}` : 'hey';
  const from = escapeHtml(input.fromName);
  const fromText = escapeText(input.fromName);
  const plan = escapeHtml(input.planTitle);
  const planText = escapeText(input.planTitle);
  const offerUrl = `${SITE_URL}${input.offerPath ?? '/offers'}`;

  const expiryHtml = input.expiresLabel
    ? `<p style="margin:0 0 24px 0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.6;color:#8B8884;">
        heads up &mdash; this one&rsquo;s good until ${escapeHtml(input.expiresLabel)}.
      </p>`
    : '';
  const expiryText = input.expiresLabel
    ? `\nheads up -- this one's good until ${escapeText(input.expiresLabel)}.\n`
    : '';

  const subject = `${fromText} sent you a night out`;

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
                you&rsquo;ve got an offer
              </p>

              <h1 style="margin:0 0 16px 0;font-family:'Inter',sans-serif;font-size:26px;font-weight:700;line-height:1.15;letter-spacing:-0.02em;color:#1A1A1A;">
                ${greeting} &mdash; <em style="font-style:italic;font-weight:600;color:#C2552B;">${from}</em> wants to take you out.
              </h1>

              <p style="margin:0 0 24px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#1A1A1A;">
                the plan: <strong>${plan}</strong>. say yes, pass, or tweak it &mdash; it&rsquo;s your call.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td bgcolor="#1A1A1A" style="background-color:#1A1A1A;border-radius:9999px;">
                    <a class="btn" href="${offerUrl}" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:'Inter',sans-serif;font-size:15px;font-weight:600;color:#FDF9F3;text-decoration:none;border-radius:9999px;">
                      see the offer &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              ${expiryHtml}

              <hr style="border:none;border-top:1px solid #E8DFCB;margin:26px 0 22px 0;">

              <p style="margin:0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.6;color:#1A1A1A;">
                have a good night out,<br>Lucas
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 8px 0 8px;">
              <p style="margin:0;font-family:'Inter',sans-serif;font-size:11px;line-height:1.6;color:#8B8884;">
                <a href="${SITE_URL}" style="color:#1A1A1A;text-decoration:underline;">tryafter5.app</a>
                &middot; curated date plans for Kelowna couples
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting} -- ${fromText} wants to take you out.

the plan: ${planText}. say yes, pass, or tweak it -- it's your call.

see the offer: ${offerUrl}
${expiryText}
have a good night out,
Lucas

----------
tryafter5.app -- curated date plans for Kelowna couples`;

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

// Plain-text escape: strip control/markup-ish chars that could break the
// text part or be used for header injection upstream.
function escapeText(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}
