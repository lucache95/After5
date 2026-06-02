// Email copy for the "email me the full plan" path on /create. The full plan PDF
// is the carrot (locked decision #3): we attach it and nudge toward going on the
// date for real. Reuses the shared Barbiecore email shell (lib/email/layout.ts) —
// note the real export is emailShell({ title, body, siteUrl }), not emailLayout.
import { emailShell, ctaButton, eyebrow, BRAND, FONT_BODY, FONT_HEADING } from './layout';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPlanEmail(args: { firstName: string | null; itineraryTitle: string }) {
  const hi = args.firstName ? `hey ${args.firstName.toLowerCase()}` : 'hey';
  const titleSafe = escapeHtml(args.itineraryTitle);
  const subject = `your date plan: ${args.itineraryTitle}`;

  const cardBody = `
    ${eyebrow('your plan is ready', BRAND.accent)}

    <h1 style="margin:0 0 16px 0;font-family:${FONT_HEADING};font-size:32px;font-weight:400;line-height:1.05;color:${BRAND.ink};">
      ${hi} &mdash; here&rsquo;s <span style="color:${BRAND.accent};">${titleSafe}</span>.
    </h1>

    <p style="margin:0 0 20px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      the full plan you built is attached as a pdf &mdash; every stop, the timing, the why. print it, screenshot it, whatever works.
    </p>

    <p style="margin:0 0 24px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">
      want to actually go on it? after5 turns a plan into a real date.
    </p>

    ${ctaButton({ href: `${SITE_URL}/create`, label: 'find your person &rarr;' })}`;

  const html = emailShell({
    title: 'your date plan is ready',
    preheader: `${args.itineraryTitle} — attached as a pdf`,
    body: cardBody,
    siteUrl: SITE_URL,
    maxWidth: 600,
  });

  const text = `${hi}, your full plan "${args.itineraryTitle}" is attached as a pdf. go on it for real at ${SITE_URL}/create`;

  return { subject, html, text };
}
