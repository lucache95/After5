// Offer-expiring email — a gentle nudge when an unanswered offer is about to
// lapse. Barbiecore brand (shared shell); lowercase, no-guilt voice.

import { emailShell, eyebrow, ctaButton, hairline, BRAND, FONT_BODY, FONT_HEADING } from './layout';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

export interface OfferExpiringEmailInput {
  /** Recipient email — the person sitting on the offer. */
  email: string;
  /** Recipient's first name, if known. */
  firstName?: string | null;
  /** Display name of the person who sent the offer. */
  fromName: string;
  /** The plan/night the offer is for. */
  planTitle: string;
  /** Friendly time-left copy, e.g. "in 2 hours" or "at midnight tonight". */
  expiresLabel: string;
  /** Path to open the offer, e.g. "/offers/abc123". Defaults to /offers. */
  offerPath?: string | null;
}

export interface RenderedOfferEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderOfferExpiringEmail(
  input: OfferExpiringEmailInput,
): RenderedOfferEmail {
  const greeting = input.firstName ? `hey ${escapeText(input.firstName)}` : 'hey';
  const from = escapeHtml(input.fromName);
  const fromText = escapeText(input.fromName);
  const plan = escapeHtml(input.planTitle);
  const planText = escapeText(input.planTitle);
  const expires = escapeHtml(input.expiresLabel);
  const expiresText = escapeText(input.expiresLabel);
  const offerUrl = `${SITE_URL}${input.offerPath ?? '/offers'}`;

  const subject = `your offer from ${fromText} is about to lapse`;

  const cardBody = `
    ${eyebrow('last call', BRAND.accent)}

    <h1 style="margin:0 0 16px 0;font-family:${FONT_HEADING};font-size:30px;font-weight:400;line-height:1.1;color:${BRAND.ink};">
      ${greeting} &mdash; ${from}&rsquo;s offer wraps up <span style="color:${BRAND.accent};">${expires}</span>.
    </h1>

    <p style="margin:0 0 24px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      still on the table: <strong>${plan}</strong>. no pressure &mdash; but if you want it, now&rsquo;s the moment to say so.
    </p>

    ${ctaButton({ href: offerUrl, label: 'answer the offer &rarr;' })}

    <p style="margin:8px 0 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.muted};">
      do nothing and it&rsquo;ll quietly expire &mdash; no harm done.
    </p>

    ${hairline()}

    <p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.ink};">
      later,<br>lucas
    </p>`;

  const html = emailShell({
    title: escapeHtml(subject),
    preheader: `${fromText}'s offer wraps up ${expiresText}`,
    body: cardBody,
    siteUrl: SITE_URL,
    maxWidth: 600,
  });

  const text = `${greeting} -- ${fromText}'s offer wraps up ${expiresText}.

still on the table: ${planText}. no pressure -- but if you want it, now's the moment to say so.

answer the offer: ${offerUrl}

do nothing and it'll quietly expire -- no harm done.

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

function escapeText(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}
