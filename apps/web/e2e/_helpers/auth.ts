// PKCE login helper (reality #4). Admin generate_link gives an IMPLICIT link that does
// NOT set SSR cookies → protected routes bounce to /login. We drive the real flow:
// /login → "Email me a sign-in link" (sets PKCE verifier cookie) → fetch link from Mailpit
// → navigate the verify URL in the SAME context → /auth/callback exchanges → authed.
import { expect, type BrowserContext, type Page } from '@playwright/test';

const MAILPIT = 'http://127.0.0.1:54324';

async function findVerifyUrl(context: BrowserContext, email: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  const wanted = email.toLowerCase();
  while (Date.now() < deadline) {
    const listRes = await context.request.get(`${MAILPIT}/api/v1/messages?limit=20`);
    const list = (await listRes.json()) as { messages?: Array<{ ID: string; To: Array<{ Address: string }> }> };
    const msgs = list.messages ?? [];
    for (const m of msgs) {
      const to = (m.To ?? []).map((t) => t.Address.toLowerCase());
      if (!to.includes(wanted)) continue;
      const detailRes = await context.request.get(`${MAILPIT}/api/v1/message/${m.ID}`);
      const detail = (await detailRes.json()) as { HTML?: string; Text?: string };
      const body = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`;
      // The verify URL is `…/auth/v1/verify?token=pkce_…&type=magiclink&redirect_to=…`
      // (note the `&type=` segment between token and redirect_to). Match the whole
      // URL up to the first whitespace/quote/angle-bracket, then normalise &amp;.
      const match = body.match(/https?:\/\/[^"\s<]*auth\/v1\/verify\?token=pkce_[^"\s<]*/);
      if (match) return match[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`[auth helper] no PKCE sign-in link for ${email} in Mailpit within 20s`);
}

export async function loginAs(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('textbox', { name: /email/i }).fill(email);
  // LoginForm CTA reads "email me a link" (was "email me a sign-in link"); match both.
  await page.getByRole('button', { name: /email me a (sign-in )?link/i }).click();
  // Confirm the "we sent a link" confirmation rendered before polling Mailpit.
  await expect(page.getByText(/sent a sign-in link/i)).toBeVisible();

  const verifyUrl = await findVerifyUrl(context, email);
  await page.goto(verifyUrl);
  // The callback redirects to an authed route; assert we are NOT back on /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  return page;
}

// Pull the signed-in user's access_token (JWT) out of the @supabase/ssr auth
// cookie so the negatives can call the match-* edge functions with a real Bearer
// (functions verify the JWT — apikey alone gets a 401 auth_mismatch). The ssr
// cookie value is `base64-<b64(JSON session)>`, chunked across `…auth-token.0/.1`
// when large. We reassemble, strip the prefix, decode, and read access_token.
export async function accessToken(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const authCookies = cookies
    .filter((c) => /sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (authCookies.length === 0) throw new Error('[auth helper] no supabase auth cookie found — not logged in?');
  let raw = authCookies.map((c) => c.value).join('');
  if (raw.startsWith('base64-')) {
    raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
  } else {
    raw = decodeURIComponent(raw);
  }
  const session = JSON.parse(raw) as { access_token?: string };
  if (!session.access_token) throw new Error('[auth helper] auth cookie has no access_token');
  return session.access_token;
}
