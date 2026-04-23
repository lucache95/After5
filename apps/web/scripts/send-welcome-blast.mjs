// One-off: blast the welcome email to everyone who has signed up.
// Filters out test/fake-domain entries. Rate limits at 10/sec (Resend cap).
// Logs each send to console with Resend ID for audit.
//
// Run: node scripts/send-welcome-blast.mjs
// Dry-run (lists recipients + shows subject only): node scripts/send-welcome-blast.mjs --dry

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const DRY = process.argv.includes('--dry');
const SITE_URL = 'https://tryafter5.app';
const EMAIL_ASSETS =
  'https://ufufmcpnysvwtutpbian.supabase.co/storage/v1/object/public/itinerary-covers/email';

// Domains we KNOW are fake/test. Anything else is treated as real.
const BLOCKED_DOMAINS = new Set(['example.com', 'jsjdjd.com', 'museumness.com']);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

function renderWelcome({ firstName }) {
  const greeting = firstName ? `Hey ${firstName}` : 'Hey';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Welcome to After5</title>
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
            <td align="left" style="padding:0 0 36px 0;">
              <a href="${SITE_URL}" style="font-family:'Inter',sans-serif;font-size:20px;font-weight:700;color:#1A1A1A;text-decoration:none;letter-spacing:-0.01em;">After5</a>
            </td>
          </tr>
          <tr>
            <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E8DFCB;border-radius:18px;padding:36px 32px;">
              <p style="margin:0 0 12px 0;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8B8884;">
                You&rsquo;re in
              </p>
              <h1 style="margin:0 0 16px 0;font-family:'Inter',sans-serif;font-size:30px;font-weight:700;line-height:1.1;letter-spacing:-0.02em;color:#1A1A1A;">
                ${greeting} &mdash; welcome to <em style="font-style:italic;font-weight:600;color:#C2552B;">After5</em>.
              </h1>
              <p style="margin:0 0 8px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#1A1A1A;">
                I&rsquo;m Lucas. I built After5 because I was tired of spending 40 minutes
                deciding where to take my partner before half the spots closed.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px 0;">
                <tr>
                  <td align="center" valign="middle" style="padding:8px 0;">
                    <img src="${EMAIL_ASSETS}/polaroid-west-kelowna.png"
                         width="202" height="275" alt="Couple on a trail above Okanagan Lake"
                         style="display:inline-block;width:202px;height:275px;border:0;outline:0;margin-right:-32px;vertical-align:middle;">
                    <img src="${EMAIL_ASSETS}/polaroid-lakeside.png"
                         width="181" height="246" alt="Couple at Okanagan Lake"
                         style="display:inline-block;width:181px;height:246px;border:0;outline:0;margin-left:-32px;margin-top:34px;vertical-align:middle;">
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#6B6864;">
                Here&rsquo;s what you can do right now:
              </p>
              <ul style="margin:0 0 24px 0;padding-left:18px;font-family:'Inter',sans-serif;font-size:15px;line-height:1.7;color:#1A1A1A;">
                <li><strong>Plan a date</strong> &mdash; 5 questions, 30 seconds, 3 real plans.</li>
                <li><strong>Save what you love</strong> &mdash; tap the heart on any plan; it lives in your dashboard.</li>
                <li><strong>Browse the catalog</strong> &mdash; every plan a Kelownan&rsquo;s built is at /dates.</li>
              </ul>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td bgcolor="#1A1A1A" style="background-color:#1A1A1A;border-radius:9999px;">
                    <a class="btn" href="${SITE_URL}/plan" target="_blank"
                       style="display:inline-block;padding:14px 32px;font-family:'Inter',sans-serif;font-size:15px;font-weight:600;color:#FDF9F3;text-decoration:none;border-radius:9999px;">
                      Plan tonight &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">Two things to know:</p>
              <p style="margin:0 0 8px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                1. You&rsquo;re one of the first 100. That means After5 stays free for you, forever &mdash; every future feature included.
              </p>
              <p style="margin:0 0 24px 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                2. This is built by one person (me). Things will break. If you spot anything wrong &mdash; a closed restaurant, a bad photo, a button that doesn&rsquo;t work &mdash; reply to this email or hit <a href="${SITE_URL}/tell-us" style="color:#C2552B;text-decoration:underline;">tryafter5.app/tell-us</a>. I read every note.
              </p>
              <p style="margin:24px 0 0 0;font-family:'Inter',sans-serif;font-size:15px;line-height:1.6;color:#1A1A1A;">
                Have a good night out,<br>
                Lucas (the ai guy) Senechal
              </p>
              <p style="margin:20px 0 0 0;font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:#6B6864;">
                <strong style="color:#1A1A1A;">P.S.</strong> Know a Kelowna spot that isn&rsquo;t on After5 yet? Send it to me at <a href="${SITE_URL}/tell-us" style="color:#C2552B;text-decoration:underline;">tryafter5.app/tell-us</a> &mdash; I add them by hand, one at a time.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 8px 0 8px;">
              <p style="margin:0;font-family:'Inter',sans-serif;font-size:12px;line-height:1.6;color:#8B8884;">
                <a href="${SITE_URL}" style="color:#1A1A1A;text-decoration:underline;">tryafter5.app</a>
                &middot; Curated date plans for Kelowna couples
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${greeting} — welcome to After5.

I'm Lucas. I built After5 because I was tired of spending 40 minutes deciding where to take my partner before half the spots closed.

Here's what you can do right now:
- Plan a date: ${SITE_URL}/plan
- Save what you love: tap the heart on any plan
- Browse the catalog: ${SITE_URL}/dates

Two things to know:
1. You're one of the first 100. Free forever — every future feature included.
2. Built by one person (me). Things will break. Reply or hit ${SITE_URL}/tell-us.

Have a good night out,
Lucas (the ai guy) Senechal

P.S. Know a Kelowna spot that isn't on After5 yet? Send it to ${SITE_URL}/tell-us — I add them by hand, one at a time.`;

  return { html, text };
}

async function sendOne({ to, firstName }) {
  const { html, text } = renderWelcome({ firstName });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `After5 <${env.RESEND_FROM_EMAIL}>`,
      to,
      reply_to: env.RESEND_REPLY_TO,
      subject: 'Welcome to After5 — your first 100 spot is locked in.',
      html,
      text,
      tags: [{ name: 'category', value: 'welcome_blast' }],
    }),
  });
  const body = await res.text();
  if (!res.ok) return { to, error: `${res.status} ${body.slice(0, 120)}` };
  try {
    const j = JSON.parse(body);
    return { to, id: j.id };
  } catch {
    return { to, error: 'non-json response' };
  }
}

// ── Pull recipients ───────────────────────────────────────
const { data: subs, error } = await supabase
  .from('subscribers')
  .select('id, email, first_name, email_opt_out, created_at')
  .order('created_at', { ascending: true });
if (error) throw error;

const eligible = subs.filter((r) => {
  if (!r.email) return false;
  if (r.email_opt_out) return false;
  const domain = r.email.split('@')[1]?.toLowerCase();
  if (!domain || BLOCKED_DOMAINS.has(domain)) return false;
  return true;
});

console.log(`${subs.length} rows total · ${eligible.length} eligible · ${subs.length - eligible.length} filtered`);
eligible.forEach((r) => console.log(' →', r.email, r.first_name ? `(${r.first_name})` : ''));

if (DRY) {
  console.log('\n[DRY RUN] no sends executed');
  process.exit(0);
}

// ── Send — founder first so he sees exactly what went out ──
console.log('\nSending founder preview copy first…');
const me = await sendOne({ to: 'lucas@lucassenechal.com', firstName: 'Lucas' });
console.log('   me →', me.id ?? me.error);
await new Promise((r) => setTimeout(r, 150));

// ── Blast ──────────────────────────────────────────────────
console.log('\nBlasting…');
let sent = 0;
let failed = 0;
for (const r of eligible) {
  const result = await sendOne({ to: r.email, firstName: r.first_name });
  if (result.id) {
    sent += 1;
    console.log(`   ${r.email} → ${result.id}`);
  } else {
    failed += 1;
    console.log(`   ${r.email} → FAILED ${result.error}`);
  }
  await new Promise((res) => setTimeout(res, 150));
}
console.log(`\ndone. sent=${sent} failed=${failed}`);
