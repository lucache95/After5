// Founder alert: a plain internal email to Lucas every time a NET-NEW person
// joins the waitlist. Best-effort (sendEmail never throws); fired non-blocking
// from /api/waitlist ONLY on a genuinely new insert — not idempotent re-joins.
// Recipient defaults to lucas@lucassenechal.com; override with WAITLIST_ALERT_EMAIL.
import { sendEmail } from './resend';

const ALERT_TO = process.env.WAITLIST_ALERT_EMAIL ?? 'lucas@lucassenechal.com';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sendWaitlistSignupAlert(opts: { email: string; city?: string | null }): Promise<void> {
  const city = opts.city?.trim() || '—';
  await sendEmail({
    to: ALERT_TO,
    tag: 'waitlist_alert',
    subject: `new after5 waitlist signup — ${opts.email}${opts.city?.trim() ? ` (${city})` : ''}`,
    text: `New after5 waitlist signup\n\nEmail: ${opts.email}\nCity: ${city}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#2b1a26;line-height:1.6;">
      <p style="margin:0 0 12px;font-size:18px;font-weight:600;">🎉 new after5 waitlist signup</p>
      <p style="margin:0 0 6px;"><strong>email:</strong> ${escapeHtml(opts.email)}</p>
      <p style="margin:0 0 6px;"><strong>city:</strong> ${escapeHtml(city)}</p>
    </div>`,
  });
}
