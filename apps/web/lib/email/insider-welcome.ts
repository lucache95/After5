// Insider welcome email — sent when an application is approved.
// Same warm-cream branded pattern as welcome.ts and post-date-feedback.ts.

import { sendEmail } from './resend';
import { emailShell, eyebrow, ctaButton, hairline, BRAND, FONT_BODY, FONT_HEADING } from './layout';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

const ROLE_DESCRIPTIONS: Record<string, string> = {
  scout:
    'as a scout, you find the hidden spots and report back. your finds help everyone plan better nights.',
  tester:
    'as a tester, you go on after5 dates and give honest feedback. your reviews keep the quality bar high.',
  curator:
    'as a curator, you write and polish venue descriptions, vibes, and local detail. your words make every plan feel personal.',
  ambassador:
    'as an ambassador, you spread the word and represent after5 in your scene. you are the face of better nights out.',
};

export async function sendInsiderWelcomeEmail(opts: {
  to: string;
  firstName: string | null;
  role: string;
}) {
  const greeting = opts.firstName ? `hey ${escapeHtml(opts.firstName)}` : 'hey';
  const roleLabel = opts.role.toLowerCase();
  const roleDesc =
    ROLE_DESCRIPTIONS[opts.role] ?? 'you are now an official after5 insider.';

  const cardBody = `
    ${eyebrow('you&rsquo;re in', BRAND.accent)}

    <h1 style="margin:0 0 16px 0;font-family:${FONT_HEADING};font-size:32px;font-weight:400;line-height:1.05;color:${BRAND.ink};">
      ${greeting} &mdash; welcome to <span style="color:${BRAND.accent};">after5 insiders</span>.
    </h1>

    <p style="margin:0 0 20px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      your application&rsquo;s approved. you&rsquo;re officially on the crew that shapes the best nights out.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;width:100%;">
      <tr>
        <td style="background-color:${BRAND.pink};border:1px solid ${BRAND.hairline};border-radius:16px;padding:16px 20px;">
          <p style="margin:0 0 4px 0;font-family:${FONT_BODY};font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:${BRAND.accent};">
            your role
          </p>
          <p style="margin:0 0 8px 0;font-family:${FONT_HEADING};font-size:22px;font-weight:400;color:${BRAND.ink};">
            ${escapeHtml(roleLabel)}
          </p>
          <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.5;color:${BRAND.ink};">
            ${roleDesc}
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.muted};">
      head to your insider dashboard for your first tasks and points. the leaderboard&rsquo;s waiting.
    </p>

    ${ctaButton({ href: `${SITE_URL}/insiders`, label: 'open your dashboard &rarr;' })}

    ${hairline()}

    <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.ink};">
      glad to have you,<br>lucas
    </p>`;

  const html = emailShell({
    title: 'welcome to after5 insiders',
    preheader: `you're an after5 insider — ${roleLabel}`,
    body: cardBody,
    siteUrl: SITE_URL,
    maxWidth: 600,
  });

  const text = `${greeting} -- welcome to after5 insiders.

your application's approved. you're officially on the crew that shapes the best nights out.

your role: ${roleLabel}
${roleDesc}

head to your insider dashboard for your first tasks and points:
${SITE_URL}/insiders

glad to have you,
lucas

----------
tryafter5.app -- the dating app that's actually fun`;

  return sendEmail({
    to: opts.to,
    subject: `welcome to after5 insiders -- you're a ${roleLabel}`,
    html,
    text,
    tag: 'insider-welcome',
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
