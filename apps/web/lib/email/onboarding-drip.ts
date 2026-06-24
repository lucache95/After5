// The onboarding drip: 5 feature-teaching emails over a new user's first 14
// days (days 2/4/7/11/14), fired by /api/cron/onboarding-drip. Same warm-cream
// brand as the welcome + weekly digest. Each email teaches ONE lesser-known
// feature with a single CTA. Copy is intentionally short, lowercase, dry —
// founder voice (worth a copy/stop-slop polish before the Sept launch).

import { makeUnsubToken } from './unsubscribe-token';
import { emailShell, eyebrow, ctaButton, hairline, BRAND, FONT_BODY, FONT_HEADING } from './layout';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface Rendered { subject: string; html: string; text: string; }

interface StepDef {
  /** Days after welcome_sent_at this step fires. */
  day: number;
  /** Resend analytics tag. */
  tag: string;
  subject: string;
  eyebrowLabel: string;
  heading: string;
  /** Paragraphs (plain text; rendered into <p> for html). */
  paras: string[];
  cta: { label: string; path: string };
}

// day offsets must stay ASCENDING and match STEP count (the cron maps step N → STEPS[N-1]).
export const DRIP_STEPS: StepDef[] = [
  {
    day: 2, tag: 'drip_planner',
    subject: 'your next date, planned in one tap',
    eyebrowLabel: 'getting started · 1 of 5',
    heading: "skip the 'so… where should we go?'",
    paras: [
      "after5 builds a whole night for you — real venues, timing, the works — from a single tap. don't like a stop? swap it. want it cheaper, or more low-key? say so.",
      "it's how every date here starts. give it a spin:",
    ],
    cta: { label: 'build a night', path: '/create/generate' },
  },
  {
    day: 4, tag: 'drip_matching',
    subject: 'how matching actually works here',
    eyebrowLabel: 'the idea · 2 of 5',
    heading: 'you match on the plan, not the face',
    paras: [
      "no endless swiping on photos. you like a night someone posted, they like you back — and you're locked into a real date that's already planned.",
      "the face comes after. less small talk, more showing up. see what's on tonight:",
    ],
    cta: { label: "see tonight's nights", path: '/feed' },
  },
  {
    day: 7, tag: 'drip_verified',
    subject: 'why everyone on after5 is real',
    eyebrowLabel: 'trust · 3 of 5',
    heading: 'id-verified, every single person',
    paras: [
      "before anyone can match, they verify their id. the person who shows up is the person from the photos — no catfish, no surprises.",
      "if you haven't finished yours yet, it takes a minute:",
    ],
    cta: { label: 'finish your profile', path: '/account' },
  },
  {
    day: 11, tag: 'drip_power',
    subject: 'the after5 move most people miss',
    eyebrowLabel: 'pro tip · 4 of 5',
    heading: 'reuse a night you love',
    paras: [
      "found a date plan you loved? reuse it as a fresh draft and post your own version in seconds — same great night, your name on it.",
      "or save one to your list and come back when the timing's right. browse a few:",
    ],
    cta: { label: 'browse nights', path: '/feed' },
  },
  {
    day: 14, tag: 'drip_first_date',
    subject: 'your first date is waiting',
    eyebrowLabel: 'go time · 5 of 5',
    heading: 'now the fun part',
    paras: [
      "you're all set up. accept an offer or post a night of your own and actually get out there — that's the whole point.",
      "and if anything's felt off these two weeks, just hit reply. i read every one.",
    ],
    cta: { label: 'find a date', path: '/feed' },
  },
];

export function renderDripStep(step: number, opts: { email: string; firstName?: string | null }): Rendered | null {
  const def = DRIP_STEPS[step - 1];
  if (!def) return null;

  const greetingName = opts.firstName?.trim() ? opts.firstName.trim().toLowerCase() : 'hey';
  const greeting = opts.firstName?.trim() ? `hi ${greetingName},` : 'hey,';
  const href = `${SITE_URL}${def.cta.path}`;
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${makeUnsubToken(opts.email)}`;

  const bodyParas = def.paras
    .map((p) => `<p style="margin:0 0 14px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">${escapeHtml(p)}</p>`)
    .join('');

  const body = `
    ${eyebrow(def.eyebrowLabel, BRAND.accent)}
    <h1 style="margin:0 0 16px 0;font-family:${FONT_HEADING};font-size:26px;font-weight:400;line-height:1.15;color:${BRAND.ink};">${escapeHtml(def.heading)}</h1>
    <p style="margin:0 0 14px 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${BRAND.ink};">${escapeHtml(greeting)}</p>
    ${bodyParas}
    ${ctaButton({ href, label: def.cta.label })}
    ${hairline()}
    <p style="margin:0;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${BRAND.muted};">— lucas, after5</p>
  `;

  const html = emailShell({
    title: escapeHtml(def.subject),
    body,
    siteUrl: SITE_URL,
    preheader: def.paras[0],
    unsubUrl,
    unsubLabel: "done with these tips?",
  });

  const text = `${greeting}

${def.paras.join('\n\n')}

${def.cta.label}: ${href}

— lucas, after5

done with these tips? unsubscribe (one click): ${unsubUrl}`;

  return { subject: def.subject, html, text };
}
