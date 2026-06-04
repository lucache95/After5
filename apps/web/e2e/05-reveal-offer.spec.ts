// 05 reveal — rung 2 (the offer stage): the matched searcher lands on their
// offer-received surface (/offers/[offerId]). The host avatar softens one step from
// the feed (rung-1 blur(8px) → rung-2 blur(3px)) as a match reward, but the night
// still leads (experience-led, REQ-E15) and the clear face is NEVER fetched pre-lock.
//
// This spec reuses the SHARED privacy-invariant network helper from 05-reveal-feed
// (every signed photo path on a pre-lock surface ends in _blurred.jpg). The offer is
// seeded host→candidate via seedChatThread (an active offer + open thread); the
// candidate reaches /offers/[offerId] and the surface is exercised end to end.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedChatThread, cleanupChat, type ChatSeedResult } from './_helpers/seed';
import { captureSignedPaths, assertNoClearPhotoSigned } from './05-reveal-feed.spec';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Upload a REAL blurred storage object for the host and point profiles.blurred_photo_url
// at it (a storage PATH). This gives the rung-2 signing path teeth: the offer loader
// signs <hostId>/<id>_blurred.jpg, a real storage/v1/object/sign request fires, and the
// privacy-invariant assertion has something to check.
async function seedHostBlurredPhoto(hostId: string): Promise<void> {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const path = `${hostId}/seed_blurred.jpg`;
  const bytes = readFileSync(join(process.cwd(), 'public', 'places', 'place-walk.jpg'));
  const { error: upErr } = await sb.storage
    .from('profile-photos')
    .upload(path, bytes, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw new Error(`seed blurred upload: ${upErr.message}`);
  const { error: updErr } = await sb.from('profiles').update({ blurred_photo_url: path }).eq('id', hostId);
  if (updErr) throw new Error(`seed blurred path: ${updErr.message}`);
}

let seed: ChatSeedResult;

test.beforeAll(async () => {
  seed = await seedChatThread();
  await seedHostBlurredPhoto(seed.hostId);
});
test.afterAll(async () => {
  if (seed) await cleanupChat(seed);
});

test('rung 2: offer surface softens the host face without leaking the clear photo', async ({ browser }) => {
  const candContext = await browser.newContext();
  const candPage: Page = await loginAs(candContext, seed.candEmail);

  const signed = captureSignedPaths(candPage);

  await candPage.goto(`/offers/${seed.offerId}`);

  // The offer surface renders for the candidate party.
  await expect(candPage.getByRole('heading', { name: /you've got an offer/i })).toBeVisible({ timeout: 20_000 });

  // RUNG 2 visual: the host hint shows the {first_name}, {age} label (same copy as rung 1).
  // The seed host is "Maya <runId>" born 1992-04-12, so the label reads "maya, <age>".
  await expect(candPage.getByText(/maya[^,]*,\s*\d+/i).first()).toBeVisible({ timeout: 15_000 });

  // The rung-2 avatar is a real signed blurred image carrying CSS blur-[3px] — one step
  // SOFTER than the feed's rung-1 blur-[8px]. Anchored on the stable data attribute.
  const rung2Avatar = candPage.locator('img[data-rung2-avatar]').first();
  await expect(rung2Avatar).toBeVisible({ timeout: 15_000 });
  await expect(rung2Avatar).toHaveClass(/blur-\[3px\]/);
  // It must NOT carry the heavier rung-1 blur (proves rung 2 is softer, not identical).
  await expect(rung2Avatar).not.toHaveClass(/blur-\[8px\]/);

  // EXPERIENCE-LED (REQ-E15): the night/plan leads, the avatar is secondary. The "the
  // night" section + the seeded plan stop render alongside the small host hint.
  await expect(candPage.getByText(/the night/i).first()).toBeVisible();
  await expect(candPage.getByText(/the train station pub/i).first()).toBeVisible({ timeout: 15_000 });

  // PRIVACY INVARIANT: across the whole offer surface, no clear host photo was signed —
  // every signed photo path ends in _blurred.jpg.
  assertNoClearPhotoSigned(signed);

  await candContext.close();
});
