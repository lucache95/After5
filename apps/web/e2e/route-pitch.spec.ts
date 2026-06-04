// Pitch-deck screenshot capture (NOT a CI test — run on demand to refresh the
// investor deck's product shots). Reuses the real seed + PKCE login helpers and
// drives the genuine flows at a phone viewport, then screenshots:
//   01-feed     the swipe feed (NightCard)
//   02-detail   the blind-safe full plan (the AI-generated night)
//   03-chat     a live conversation between the two parties
//   04-match    the lock screen after accepting an offer
//   05-reveal   the post-lock identity reveal (ProfileCard)
// Matches testMatch via the `route-` prefix. Output → .planning/pitch/shots/.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedChatThread, cleanupChat, type ChatSeedResult } from './_helpers/seed';

const SHOT_DIR = '/Users/lucas/Projects/After5/.planning/pitch/shots';
const shot = (name: string) => `${SHOT_DIR}/${name}`;
const MOBILE = { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';
const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Hide the Next.js dev-overlay badge ("N · 1 issue") so product shots are clean.
async function clean(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal,[data-nextjs-toast]{display:none!important}' }).catch(() => {});
}

// Tasteful Unsplash portrait (images.unsplash.com is allow-listed in next.config)
// so the post-lock reveal shows a real face instead of the initials placeholder.
const PORTRAIT = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=640&q=80';

let seed: ChatSeedResult;
test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  seed = await seedChatThread();
  const sb = admin();
  // Replace the shared seed's run-id'd test data with clean, real-looking values.
  // profiles are keyed by id == userId (promoteProfile updates .eq('id', userId)).
  const p1 = await sb.from('profiles').update({ first_name: 'Maya', clear_photo_url: PORTRAIT }).eq('id', seed.hostId).select('id,first_name');
  const p2 = await sb.from('profiles').update({ first_name: 'Jordan' }).eq('id', seed.candId).select('id,first_name');
  const it = await sb.from('itineraries').update({ title: 'cocktails & charcuterie', hook: 'a slow burn downtown' }).eq('user_id', seed.hostId).select('id,title');
  if (p1.error || p2.error || it.error) throw new Error('fixup failed: ' + JSON.stringify([p1.error, p2.error, it.error]));
  // Prior runs leave seeking nights behind; the candidate's feed shows all matches and a
  // stale one can sort first. Cancel every OTHER seeking night so only this run's shows.
  const cx = await sb.from('date_instances').update({ status: 'cancelled' }).eq('status', 'seeking').neq('id', seed.instanceId).select('id');
  console.log('PITCH FIXUP →', JSON.stringify({ host: p1.data, cand: p2.data, itin: it.data, cancelledOthers: cx.data?.length, err: cx.error?.message }));
});
test.afterAll(async () => {
  if (seed) await cleanupChat(seed);
});

test('capture pitch product screenshots', async ({ browser }) => {
  test.setTimeout(180_000);
  const candCtx = await browser.newContext(MOBILE);
  const hostCtx = await browser.newContext(MOBILE);
  const cand: Page = await loginAs(candCtx, seed.candEmail);
  const host: Page = await loginAs(hostCtx, seed.hostEmail);

  // 01 — FEED: the candidate browses the host's seeded night.
  await cand.goto('/feed');
  const card = cand.getByRole('button', { name: /tap to read the full plan/i });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await clean(cand);
  await cand.waitForTimeout(1400); // settle images + entrance animation
  await cand.screenshot({ path: shot('01-feed.png') });

  // 02 — DETAIL: tap the card → the full blind-safe plan (the AI-generated night).
  await card.click();
  await expect(cand.getByText(/the train station pub/i)).toBeVisible({ timeout: 15_000 });
  await clean(cand);
  await cand.waitForTimeout(900);
  await cand.screenshot({ path: shot('02-detail.png') });
  await cand.keyboard.press('Escape').catch(() => {});

  // 03 — CHAT: host sends, candidate replies, capture the candidate's conversation.
  await host.goto(`/messages/${seed.threadId}`);
  await host.getByRole('textbox', { name: /message/i }).fill('ok this plan looks unreal, i’m in');
  await host.getByRole('button', { name: /send it/i }).click();
  await cand.goto(`/messages/${seed.threadId}`);
  await expect(cand.getByText(/looks unreal/i)).toBeVisible({ timeout: 15_000 });
  await cand.getByRole('textbox', { name: /message/i }).fill('same!! thursday 7pm works ✨');
  await cand.getByRole('button', { name: /send it/i }).click();
  await expect(cand.getByText(/thursday 7pm/i)).toBeVisible({ timeout: 15_000 });
  await clean(cand);
  await cand.waitForTimeout(900);
  await cand.screenshot({ path: shot('03-chat.png') });

  // 04 — MATCH: candidate accepts the seeded offer → lands on the lock screen.
  await cand.goto(`/offers/${seed.offerId}`);
  await expect(cand.getByText(/you've got an offer/i)).toBeVisible({ timeout: 15_000 });
  await cand.getByRole('button', { name: /^accept$/i }).click();
  await expect(cand).toHaveURL(/\/matches\//, { timeout: 25_000 });
  await clean(cand);
  await cand.waitForTimeout(1300);
  await cand.screenshot({ path: shot('04-match.png') });

  // 05 — REVEAL: open the identity reveal.
  await cand.getByRole('button', { name: /see their profile/i }).click();
  await expect(cand.getByRole('heading', { name: /Maya[^']*, \d+$/ })).toBeVisible({ timeout: 15_000 });
  await clean(cand);
  await cand.waitForTimeout(700);
  await cand.screenshot({ path: shot('05-reveal.png') });

  await candCtx.close();
  await hostCtx.close();
});
