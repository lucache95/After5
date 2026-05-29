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
      const match = body.match(/https?:\/\/[^"\s<]*auth\/v1\/verify\?token=pkce_[^"\s<&]*&redirect_to=[^"\s<]*/);
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
  await page.getByRole('button', { name: /email me a sign-in link/i }).click();
  // Confirm the "we sent a link" confirmation rendered before polling Mailpit.
  await expect(page.getByText(/sent a sign-in link/i)).toBeVisible();

  const verifyUrl = await findVerifyUrl(context, email);
  await page.goto(verifyUrl);
  // The callback redirects to an authed route; assert we are NOT back on /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  return page;
}
