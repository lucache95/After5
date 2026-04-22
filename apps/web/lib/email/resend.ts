// Server-only Resend wrapper. Best-effort: never throws — failures log
// and return null so callers don't block user-facing flows on email sends.
//
// Requires RESEND_API_KEY + RESEND_FROM_EMAIL in env. RESEND_REPLY_TO is
// optional and routes inbound replies to the founder's personal inbox.

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Tag for Resend dashboard analytics — e.g., 'welcome', 'magic_link' */
  tag?: string;
}

export async function sendEmail(args: SendArgs): Promise<{ id: string } | null> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const replyTo = process.env.RESEND_REPLY_TO;

  if (!apiKey || !from) {
    console.warn('[resend] RESEND_API_KEY or RESEND_FROM_EMAIL missing — skip send');
    return null;
  }

  const fromHeader = `After5 <${from}>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader,
        to: args.to,
        subject: args.subject,
        html: args.html,
        ...(args.text ? { text: args.text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(args.tag ? { tags: [{ name: 'category', value: args.tag }] } : {}),
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[resend] send failed', res.status, txt);
      return null;
    }

    const json = await res.json() as { id?: string };
    return json.id ? { id: json.id } : null;
  } catch (err) {
    console.error('[resend] send threw', err);
    return null;
  }
}
