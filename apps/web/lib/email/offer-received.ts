// Offer-received email — fired when someone sends a user an offer for a night out.
// Barbiecore brand (shared shell): hot-pink accent, cream base, lowercase dry
// voice, one clear CTA into the offer.

import { emailShell, eyebrow, ctaButton, hairline, BRAND, FONT_BODY, FONT_HEADING } from './layout';

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
    ? `<p style="margin:0 0 8px 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.muted};">
        heads up &mdash; this one&rsquo;s good until ${escapeHtml(input.expiresLabel)}.
      </p>`
    : '';
  const expiryText = input.expiresLabel
    ? `\nheads up -- this one's good until ${escapeText(input.expiresLabel)}.\n`
    : '';

  const subject = `${fromText} sent you a night out`;

  const cardBody = `
    ${eyebrow('you got picked', BRAND.accent)}

    <h1 style="margin:0 0 16px 0;font-family:${FONT_HEADING};font-size:30px;font-weight:400;line-height:1.1;color:${BRAND.ink};">
      ${greeting} &mdash; <span style="color:${BRAND.accent};">${from}</span> wants to take you out.
    </h1>

    <p style="margin:0 0 24px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      the plan: <strong>${plan}</strong>. say yes, pass, or tweak it &mdash; it&rsquo;s your call.
    </p>

    ${ctaButton({ href: offerUrl, label: 'see the offer &rarr;' })}

    ${expiryHtml}

    ${hairline()}

    <p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.ink};">
      later,<br>lucas
    </p>`;

  const html = emailShell({
    title: escapeHtml(subject),
    preheader: `${fromText} wants to take you out`,
    body: cardBody,
    siteUrl: SITE_URL,
    maxWidth: 600,
  });

  const text = `${greeting} -- ${fromText} wants to take you out.

the plan: ${planText}. say yes, pass, or tweak it -- it's your call.

see the offer: ${offerUrl}
${expiryText}
later,
lucas

----------
tryafter5.app -- the dating app that's actually fun`;

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
