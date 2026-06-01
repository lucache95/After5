// Post-date feedback email — sent ~24h after a user's saved plan date.
// Barbiecore brand (shared shell). Links to /feedback/[token] (no auth).

import { makeFeedbackToken } from './feedback-token';
import { makeUnsubToken } from './unsubscribe-token';
import { emailShell, eyebrow, ctaButton, hairline, BRAND, FONT_BODY, FONT_HEADING } from './layout';

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
  const greeting = input.firstName ? `hey ${escapeHtml(input.firstName)}` : 'hey';
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
                 width="540" height="270" alt="${title}"
                 style="display:block;width:100%;max-width:540px;height:auto;border-radius:16px;border:1px solid ${BRAND.hairline};" />
          </td>
        </tr>
      </table>`
    : '';

  const subject = `how was "${input.dateTitle}"?`;

  const cardBody = `
    ${eyebrow('how&rsquo;d it go?', BRAND.accent)}

    <h1 style="margin:0 0 16px 0;font-family:${FONT_HEADING};font-size:30px;font-weight:400;line-height:1.1;color:${BRAND.ink};">
      ${greeting} &mdash; how was <span style="color:${BRAND.accent};">${title}</span>?
    </h1>

    <p style="margin:0 0 24px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      your date was yesterday. a quick review (3 taps, 30 seconds) makes the next one better for everyone.
    </p>

    ${coverHtml}

    ${ctaButton({ href: feedbackUrl, label: 'rate your date &rarr;' })}

    <p style="margin:8px 0 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.muted};">
      no login needed &mdash; just tap and go.
    </p>

    ${hairline()}

    <p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.ink};">
      thanks,<br>lucas
    </p>`;

  const html = emailShell({
    title: escapeHtml(subject),
    preheader: `how was ${input.dateTitle}? a quick review takes 30 seconds`,
    body: cardBody,
    siteUrl: SITE_URL,
    unsubUrl,
    unsubLabel: "don't want post-date emails?",
    maxWidth: 600,
  });

  const text = `${greeting} -- how was "${input.dateTitle}"?

your date was yesterday. a quick review (3 taps, 30 seconds) makes the next one better for everyone.

rate your date: ${feedbackUrl}

no login needed -- just tap and go.

thanks,
lucas

----------
tryafter5.app -- the dating app that's actually fun
don't want post-date emails? unsubscribe: ${unsubUrl}`;

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
