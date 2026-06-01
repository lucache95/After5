// Renders the weekly digest email — same warm-cream brand as the welcome
// email. Pulls 3 recent public itineraries from the catalog, picks one
// rotating "hidden gem", and sets a personalized greeting.

import { createAdminClient } from '@/lib/supabase/admin';
import { pickWeeklySpotlight } from './feature-spotlights';
import { makeUnsubToken } from './unsubscribe-token';
import { emailShell, eyebrow, ctaButton, hairline, BRAND, FONT_BODY, FONT_HEADING } from './layout';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tryafter5.app';

interface DigestPlanCard {
  slug: string;
  title: string;
  hook: string;
  total_cost_pp: number;
  total_duration_min: number;
}

async function loadRecentPlans(limit = 3): Promise<DigestPlanCard[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('itineraries')
    .select('slug, title, hook, total_cost_pp, total_duration_min')
    .eq('is_public', true)
    .not('slug', 'is', null)
    .not('title', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(limit);

  return (data ?? [])
    .filter((r): r is { slug: string; title: string; hook: string | null; total_cost_pp: number | null; total_duration_min: number | null } =>
      typeof r.slug === 'string' && typeof r.title === 'string'
    )
    .map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      hook: r.hook ?? '',
      total_cost_pp: Number(r.total_cost_pp ?? 0),
      total_duration_min: r.total_duration_min ?? 0,
    }));
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
  plansShown: number;
  spotlightId: string;
}

export async function renderWeeklyDigest(opts: {
  email: string;
  firstName: string | null;
}): Promise<RenderedDigest> {
  const greeting = opts.firstName ? `hey ${escapeHtml(opts.firstName)}` : 'hey';
  const spotlight = pickWeeklySpotlight();
  const plans = await loadRecentPlans(3);
  const unsubToken = makeUnsubToken(opts.email);
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${unsubToken}`;

  const subject = plans[0]
    ? `this week in after5 — ${plans[0].title}`
    : `this week in after5`;

  const planHtml = plans
    .map((p) => {
      const hr = Math.round((p.total_duration_min / 60) * 10) / 10;
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;">
          <tr>
            <td bgcolor="${BRAND.pink}" style="background-color:${BRAND.pink};border:1px solid ${BRAND.hairline};border-radius:16px;padding:18px 20px;">
              <a href="${SITE_URL}/dates/${p.slug}" style="font-family:${FONT_BODY};font-size:16px;font-weight:600;color:${BRAND.ink};text-decoration:none;line-height:1.3;">
                ${escapeHtml(p.title)}
              </a>
              ${p.hook ? `<p style="margin:6px 0 10px 0;font-family:${FONT_BODY};font-size:13px;line-height:1.55;color:${BRAND.ink};">${escapeHtml(p.hook)}</p>` : ''}
              <p style="margin:0;font-family:${FONT_BODY};font-size:12px;color:${BRAND.muted};">
                $${Math.round(p.total_cost_pp)} &middot; ${hr} hr &middot;
                <a href="${SITE_URL}/dates/${p.slug}" style="color:${BRAND.accent};text-decoration:underline;">see the plan &rarr;</a>
              </p>
            </td>
          </tr>
        </table>`;
    })
    .join('');

  const planText = plans
    .map((p) => {
      const hr = Math.round((p.total_duration_min / 60) * 10) / 10;
      return `- ${p.title} ($${Math.round(p.total_cost_pp)}, ${hr}hr) → ${SITE_URL}/dates/${p.slug}`;
    })
    .join('\n');

  const cardBody = `
    ${eyebrow('this week in <span style="color:' + BRAND.accent + '">after5</span>', BRAND.muted)}
    <h1 style="margin:0 0 14px 0;font-family:${FONT_HEADING};font-size:30px;font-weight:400;line-height:1.05;color:${BRAND.ink};">
      ${greeting} &mdash; here&rsquo;s what&rsquo;s new.
    </h1>

    <p style="margin:0 0 18px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${BRAND.muted};">
      three plans real people built this week. tap any for the full night.
    </p>

    ${planHtml}

    ${hairline()}

    ${eyebrow('hidden gem', BRAND.accent)}
    <h2 style="margin:0 0 10px 0;font-family:${FONT_HEADING};font-size:20px;font-weight:400;line-height:1.2;color:${BRAND.ink};">
      ${escapeHtml(spotlight.title)}
    </h2>
    <p style="margin:0 0 14px 0;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.ink};">
      ${escapeHtml(spotlight.body)}
    </p>
    ${
      spotlight.cta_path
        ? `<a href="${SITE_URL}${spotlight.cta_path}" style="display:inline-block;font-family:${FONT_BODY};font-size:13px;font-weight:600;color:${BRAND.accent};text-decoration:underline;">${escapeHtml(spotlight.cta_label ?? 'try it')} &rarr;</a>`
        : ''
    }

    ${hairline()}

    <p style="margin:0 0 14px 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.ink};">
      <strong>found a bug? want a place added?</strong> reply here or hit
      <a href="${SITE_URL}/tell-us" style="color:${BRAND.accent};text-decoration:underline;">tryafter5.app/tell-us</a>.
      i read every note.
    </p>

    ${ctaButton({ href: `${SITE_URL}/plan`, label: 'plan tonight &rarr;' })}

    <p style="margin:16px 0 0 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.ink};">
      later,<br>lucas
    </p>`;

  const html = emailShell({
    title: escapeHtml(subject),
    preheader: plans[0] ? `new this week: ${plans[0].title}` : 'this week in after5',
    body: cardBody,
    siteUrl: SITE_URL,
    unsubUrl,
    unsubLabel: "don't want these weekly notes?",
    maxWidth: 600,
  });

  const text = `${greeting} — this week in after5.

three plans real people built this week:
${planText || '(no new plans yet — be the first this week!)'}

──────────
HIDDEN GEM
${spotlight.title}
${spotlight.body}
${spotlight.cta_path ? `→ ${SITE_URL}${spotlight.cta_path}` : ''}

──────────
found a bug? want a place added? reply here or hit ${SITE_URL}/tell-us — i read every note.

plan tonight: ${SITE_URL}/plan

later,
lucas

──────────
don't want these weekly notes? unsubscribe (one click): ${unsubUrl}
tryafter5.app — the dating app that's actually fun`;

  return {
    subject,
    html,
    text,
    plansShown: plans.length,
    spotlightId: spotlight.id,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
