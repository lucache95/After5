// Renders the weekly digest email — same warm-cream brand as the welcome
// email. Pulls 3 recent public itineraries from the catalog, picks one
// rotating "hidden gem", and sets a personalized greeting.

import { createAdminClient } from '@/lib/supabase/admin';
import { pickWeeklySpotlight } from './feature-spotlights';
import { makeUnsubToken } from './unsubscribe-token';

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
  const greeting = opts.firstName ? `Hey ${opts.firstName}` : 'Hey';
  const spotlight = pickWeeklySpotlight();
  const plans = await loadRecentPlans(3);
  const unsubToken = makeUnsubToken(opts.email);
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${unsubToken}`;

  const subject = plans[0]
    ? `This week in After5 — ${plans[0].title}`
    : `This week in After5`;

  const planHtml = plans
    .map((p) => {
      const hr = Math.round((p.total_duration_min / 60) * 10) / 10;
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;">
          <tr>
            <td bgcolor="#F4ECDD" style="background-color:#F4ECDD;border:1px solid #E8DFCB;border-radius:12px;padding:18px 20px;">
              <a href="${SITE_URL}/dates/${p.slug}" style="font-family:'Inter',sans-serif;font-size:16px;font-weight:600;color:#1A1A1A;text-decoration:none;line-height:1.3;">
                ${escapeHtml(p.title)}
              </a>
              ${p.hook ? `<p style="margin:6px 0 10px 0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.55;color:#6B6864;">${escapeHtml(p.hook)}</p>` : ''}
              <p style="margin:0;font-family:'Inter',sans-serif;font-size:12px;color:#8B8884;">
                $${Math.round(p.total_cost_pp)} &middot; ${hr} hr &middot;
                <a href="${SITE_URL}/dates/${p.slug}" style="color:#C2552B;text-decoration:underline;">see the plan &rarr;</a>
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
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <tr>
            <td align="left" style="padding:0 0 28px 0;">
              <a href="${SITE_URL}" style="font-family:'Inter',sans-serif;font-size:20px;font-weight:700;color:#1A1A1A;text-decoration:none;letter-spacing:-0.01em;">After5</a>
            </td>
          </tr>

          <tr>
            <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E8DFCB;border-radius:18px;padding:32px 28px;">
              <p style="margin:0 0 10px 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8B8884;">
                This week in <em style="font-style:italic;font-weight:600;color:#C2552B;">After5</em>
              </p>
              <h1 style="margin:0 0 14px 0;font-family:'Inter',sans-serif;font-size:26px;font-weight:700;line-height:1.15;letter-spacing:-0.02em;color:#1A1A1A;">
                ${greeting} &mdash; here&rsquo;s what&rsquo;s new.
              </h1>

              <p style="margin:0 0 18px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.55;color:#6B6864;">
                Three plans real Kelownans built this week. Tap any to see the full night.
              </p>

              ${planHtml}

              <hr style="border:none;border-top:1px solid #E8DFCB;margin:26px 0 22px 0;">

              <p style="margin:0 0 6px 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8B8884;">
                Hidden gem
              </p>
              <h2 style="margin:0 0 10px 0;font-family:'Inter',sans-serif;font-size:18px;font-weight:600;line-height:1.3;color:#1A1A1A;">
                ${escapeHtml(spotlight.title)}
              </h2>
              <p style="margin:0 0 14px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                ${escapeHtml(spotlight.body)}
              </p>
              ${
                spotlight.cta_path
                  ? `<a href="${SITE_URL}${spotlight.cta_path}" style="display:inline-block;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;color:#C2552B;text-decoration:underline;">${escapeHtml(spotlight.cta_label ?? 'Try it')} &rarr;</a>`
                  : ''
              }

              <hr style="border:none;border-top:1px solid #E8DFCB;margin:26px 0 22px 0;">

              <p style="margin:0 0 14px 0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.6;color:#1A1A1A;">
                <strong>Found a bug? Want a place added?</strong> Reply to this email or hit
                <a href="${SITE_URL}/tell-us" style="color:#C2552B;text-decoration:underline;">tryafter5.app/tell-us</a>.
                I read every note.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px 0;">
                <tr>
                  <td bgcolor="#1A1A1A" style="background-color:#1A1A1A;border-radius:9999px;">
                    <a class="btn" href="${SITE_URL}/plan" target="_blank"
                       style="display:inline-block;padding:13px 28px;font-family:'Inter',sans-serif;font-size:14px;font-weight:600;color:#FDF9F3;text-decoration:none;border-radius:9999px;">
                      Plan tonight &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0 0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.6;color:#1A1A1A;">
                Have a good week,<br>Lucas
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
                Don&rsquo;t want these weekly notes? <a href="${unsubUrl}" style="color:#8B8884;text-decoration:underline;">Unsubscribe</a> &mdash; one click.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting} — this week in After5.

Three plans real Kelownans built this week:
${planText || '(no new plans yet — be the first this week!)'}

──────────
HIDDEN GEM
${spotlight.title}
${spotlight.body}
${spotlight.cta_path ? `→ ${SITE_URL}${spotlight.cta_path}` : ''}

──────────
Found a bug? Want a place added? Reply to this email or hit ${SITE_URL}/tell-us — I read every note.

Plan tonight: ${SITE_URL}/plan

Have a good week,
Lucas

──────────
Don't want these weekly notes? Unsubscribe (one click): ${unsubUrl}
tryafter5.app — Curated date plans for Kelowna couples`;

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
