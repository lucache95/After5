// 05 visual-capture — the AUTOMATED half of the phase-gate visual-verify (05-04 Task 1).
// Drives the same forced-local seed + PKCE login + navigation as the three reveal specs
// (05-reveal-feed / -offer / -ceremony) at the project's @420px mobile-first viewport and
// writes per-tier PNGs into the phase __visual__/ dir for the human critique (Task 2).
//
// This is a throwaway capture spec, NOT a behavioral assertion suite — the rung
// assertions live in the three reveal specs. It is GUARDED behind CAPTURE_VISUAL=1 so a
// bare `playwright test` (CI default set) skips it; run it explicitly with
//   CAPTURE_VISUAL=1 pnpm --filter @after5/web exec playwright test e2e/05-visual-capture.spec.ts
//
// The privacy invariant still has teeth here: it runs the SAME captureSignedPaths /
// assertNoClearPhotoSigned network assertion on every pre-lock surface (rung 1 + rung 2)
// before screenshotting, so a clear-photo leak during capture is a hard failure.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import {
  seedTwoUsersAndNight,
  seedChatThread,
  cleanup,
  cleanupChat,
  type SeedResult,
  type ChatSeedResult,
} from './_helpers/seed';
import { captureSignedPaths, assertNoClearPhotoSigned } from './_helpers/reveal-privacy';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Project visual-verify standard: 420px-wide mobile-first viewport (the app centers in a
// max-w-[420px] phone container; capturing at this width is the canonical recipe).
const VIEWPORT = { width: 420, height: 900 };

// PNGs land in the phase dir for the Task-2 critique. process.cwd() is apps/web under
// `pnpm --filter @after5/web`, so walk up to the repo root.
const OUT_DIR = join(process.cwd(), '..', '..', '.planning', 'phases', '05-progressive-reveal-p2', '__visual__');
mkdirSync(OUT_DIR, { recursive: true });
const out = (name: string) => join(OUT_DIR, name);

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

// Same helper the reveal specs use: upload a REAL blurred storage object for the host and
// point profiles.blurred_photo_url at the storage PATH, so the signing path is genuinely
// exercised (the privacy assertion has something real to check).
async function seedHostBlurredPhoto(hostId: string): Promise<void> {
  const sb = admin();
  const path = `${hostId}/seed_blurred.jpg`;
  const bytes = readFileSync(join(process.cwd(), 'public', 'places', 'place-walk.jpg'));
  const { error: upErr } = await sb.storage
    .from('profile-photos')
    .upload(path, bytes, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw new Error(`seed blurred upload: ${upErr.message}`);
  const { error: updErr } = await sb.from('profiles').update({ blurred_photo_url: path }).eq('id', hostId);
  if (updErr) throw new Error(`seed blurred path: ${updErr.message}`);
}

// Drive the real loop swipe -> shortlist -> offer -> accept to a lock (mirrors the
// ceremony spec's lockTheMatch) and return the candidate page + lockId for rung 3.
async function lockTheMatch(browser: Parameters<Parameters<typeof test>[2]>[0]['browser'], seed: SeedResult) {
  const hostContext = await browser.newContext({ viewport: VIEWPORT });
  const candContext = await browser.newContext({ viewport: VIEWPORT });
  const hostPage: Page = await loginAs(hostContext, seed.hostEmail);
  const candPage: Page = await loginAs(candContext, seed.candEmail);

  await candPage.goto('/feed');
  const likeBtn = candPage.getByRole('button', { name: /interested/i });
  await expect(likeBtn).toBeVisible({ timeout: 20_000 });
  await likeBtn.click();

  await hostPage.goto(`/dates/${seed.instanceId}/interested`);
  const shortlistBtn = hostPage.getByRole('button', { name: /add .* to shortlist/i }).first();
  await expect(shortlistBtn).toBeVisible({ timeout: 20_000 });
  await shortlistBtn.click();
  const sendIt = hostPage.getByRole('button', { name: /make offer to/i }).first();
  await expect(sendIt).toBeVisible({ timeout: 15_000 });
  await sendIt.click();
  await hostPage.getByRole('button', { name: /send the offer/i }).click();
  await expect(hostPage.getByText(/offer's out/i)).toBeVisible({ timeout: 15_000 });

  let offerId: string | null = null;
  for (let i = 0; i < 20 && !offerId; i++) {
    const { data } = await admin().from('offers').select('id')
      .eq('date_instance_id', seed.instanceId).eq('status', 'active').maybeSingle();
    offerId = (data?.id as string | undefined) ?? null;
    if (!offerId) await new Promise((r) => setTimeout(r, 500));
  }
  expect(offerId, 'an active offer should exist after the host sends it').toBeTruthy();

  await candPage.goto(`/offers/${offerId}`);
  await expect(candPage.getByRole('timer')).toBeVisible();
  await candPage.getByRole('button', { name: /^accept$/i }).click();
  await expect(candPage).toHaveURL(/\/matches\//, { timeout: 20_000 });

  const lockId = candPage.url().match(/\/matches\/([0-9a-f-]+)/i)?.[1] ?? null;
  expect(lockId, 'accept should route to /matches/<lockId>').toBeTruthy();

  return { hostContext, candContext, candPage, lockId: lockId as string };
}

// Guard: a bare `playwright test` (CI default set) must NOT run this capture spec.
const RUN = process.env.CAPTURE_VISUAL === '1';

test.describe('05 visual-capture @420px (forced-local, CAPTURE_VISUAL=1)', () => {
  test.skip(!RUN, 'set CAPTURE_VISUAL=1 to run the visual-capture spec');

  test('rung 1 + rung 2: feed card, detail sheet, offer surface (privacy-invariant green)', async ({ browser }) => {
    // --- Rung 1: feed card + detail sheet (pre-match, blur(8px)) ---
    const seed = await seedTwoUsersAndNight();
    await seedHostBlurredPhoto(seed.hostId);
    try {
      const candContext = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(candContext, seed.candEmail);
      const signed = captureSignedPaths(candPage);

      await candPage.goto('/feed');
      await expect(candPage.getByRole('button', { name: /interested/i })).toBeVisible({ timeout: 20_000 });
      // Wait for the rung-1 blurred host avatar to be present before the shot.
      await expect(candPage.locator('img[data-rung1-avatar]').first()).toBeVisible({ timeout: 15_000 });
      await expect(candPage.getByText(/maya[^,]*,\s*\d+/i).first()).toBeVisible({ timeout: 15_000 });
      await candPage.screenshot({ path: out('rung1-feed-card.png') });

      // Detail sheet: tap the active card.
      await candPage.getByRole('button', { name: /tap to read the full plan/i }).click();
      await expect(candPage.getByText(/swiping on the night/i)).toBeVisible({ timeout: 15_000 });
      await expect(candPage.getByText(/maya[^,]*,\s*\d+/i).first()).toBeVisible();
      await candPage.screenshot({ path: out('rung1-detail-sheet.png') });

      // PRIVACY INVARIANT (rung 1): no clear host photo signed across feed + detail.
      assertNoClearPhotoSigned(signed);
      await candContext.close();
    } finally {
      await cleanup(seed);
    }

    // --- Rung 2: offer-received surface (blur(3px), experience-led) ---
    const chat: ChatSeedResult = await seedChatThread();
    await seedHostBlurredPhoto(chat.hostId);
    try {
      const candContext = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(candContext, chat.candEmail);
      const signed = captureSignedPaths(candPage);

      await candPage.goto(`/offers/${chat.offerId}`);
      await expect(candPage.getByRole('heading', { name: /you've got an offer/i })).toBeVisible({ timeout: 20_000 });
      await expect(candPage.locator('img[data-rung2-avatar]').first()).toBeVisible({ timeout: 15_000 });
      await expect(candPage.getByText(/the train station pub/i).first()).toBeVisible({ timeout: 15_000 });
      await candPage.screenshot({ path: out('rung2-offer.png') });

      // PRIVACY INVARIANT (rung 2): no clear host photo signed on the offer surface.
      assertNoClearPhotoSigned(signed);
      await candContext.close();
    } finally {
      await cleanupChat(chat);
    }
  });

  test('rung 3: the reveal ceremony (un-blur landed + flourish + toast)', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      const { hostContext, candContext, candPage, lockId } = await lockTheMatch(browser, seed);

      // Re-enter with the justLocked signal — the ceremony auto-opens.
      await candPage.goto(`/matches/${lockId}?just=1`);
      // Toast fires with the reveal copy...
      await expect(candPage.getByText(/the face behind the night\. say hi\./i)).toBeVisible({ timeout: 15_000 });
      // ...and the un-blur settles into the Tier-3 ProfileCard (name+age heading clear).
      await expect(candPage.getByRole('heading', { name: /Maya[^']*, \d+$/ })).toBeVisible({ timeout: 15_000 });
      // Let the ~1.4s choreography settle (un-blur to 0 + flourish in) before the shot,
      // and keep the toast in frame.
      await candPage.waitForTimeout(700);
      await candPage.screenshot({ path: out('rung3-ceremony.png') });

      await hostContext.close();
      await candContext.close();
    } finally {
      await cleanup(seed);
    }
  });

  test('rung 3 reduced-motion: immediate clear photo, no glow motion, toast still fires', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      const { hostContext, candContext, candPage, lockId } = await lockTheMatch(browser, seed);

      await candPage.emulateMedia({ reducedMotion: 'reduce' });
      await candPage.goto(`/matches/${lockId}?just=1`);
      await expect(candPage.getByText(/the face behind the night\. say hi\./i)).toBeVisible({ timeout: 15_000 });
      await expect(candPage.getByRole('heading', { name: /Maya[^']*, \d+$/ })).toBeVisible({ timeout: 15_000 });
      // Reduced-motion settles immediately (≤200ms cross-fade) — a short beat is enough.
      await candPage.waitForTimeout(400);
      await candPage.screenshot({ path: out('rung3-ceremony-reduced-motion.png') });

      await hostContext.close();
      await candContext.close();
    } finally {
      await cleanup(seed);
    }
  });
});
