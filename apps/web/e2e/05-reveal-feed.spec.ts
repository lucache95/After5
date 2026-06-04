// 05 reveal — rung 1 (pre-match): the searcher senses a real person on the feed
// (blurred face + first name + age) but cannot judge the face. This spec carries the
// shared PRIVACY-INVARIANT network helper used across the reveal rungs:
//   every storage signed-photo request on a pre-lock surface MUST target a
//   *_blurred.jpg object — the clear photo path is NEVER signed pre-lock.
//
// Mirrors 5b-happy-path.spec.ts auth/seed shape (PKCE login + service-role seed).
// The visual rung-1 assertions (blurred avatar + {name, age} label) land in Task 4.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';
import { captureSignedPaths, assertNoClearPhotoSigned } from './_helpers/reveal-privacy';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Upload a REAL blurred storage object for the host and point profiles.blurred_photo_url
// at it (a storage PATH, not a local asset). This is what makes the rung-1 signing path
// genuinely exercised: the feed loader signs <hostId>/<id>_blurred.jpg, a real
// storage/v1/object/sign request fires, and the privacy-invariant assertion has teeth.
async function seedHostBlurredPhoto(hostId: string): Promise<string> {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const path = `${hostId}/seed_blurred.jpg`;
  const bytes = readFileSync(join(process.cwd(), 'public', 'places', 'place-walk.jpg'));
  const { error: upErr } = await sb.storage
    .from('profile-photos')
    .upload(path, bytes, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw new Error(`seed blurred upload: ${upErr.message}`);
  const { error: updErr } = await sb.from('profiles').update({ blurred_photo_url: path }).eq('id', hostId);
  if (updErr) throw new Error(`seed blurred path: ${updErr.message}`);
  return path;
}

// The shared privacy-invariant network helper (captureSignedPaths / assertNoClearPhotoSigned)
// lives in ./_helpers/reveal-privacy so the offer + ceremony specs can reuse it without one
// test file importing another (Playwright forbids that).

let seed: SeedResult;

test.beforeAll(async () => {
  seed = await seedTwoUsersAndNight();
  await seedHostBlurredPhoto(seed.hostId);
});
test.afterAll(async () => {
  if (seed) await cleanup(seed);
});

test('rung 1: feed surfaces a host hint without leaking the clear face', async ({ browser }) => {
  const candContext = await browser.newContext();
  const candPage: Page = await loginAs(candContext, seed.candEmail);

  const signed = captureSignedPaths(candPage);

  // Feed: the candidate sees the host's night.
  await candPage.goto('/feed');
  const likeBtn = candPage.getByRole('button', { name: /interested/i });
  await expect(likeBtn).toBeVisible({ timeout: 20_000 });

  // RUNG 1 visual: the card shows the host hint — a blurred avatar + {first_name}, {age}.
  // The seed host is "Maya <runId>" born 1992-04-12, so the label reads "maya, <age>".
  await expect(candPage.getByText(/maya[^,]*,\s*\d+/i).first()).toBeVisible({ timeout: 15_000 });
  // The heavy-blur avatar is a real signed blurred image carrying the blur-[8px]
  // utility (face unreadable). Anchored on the stable data attribute, not the class.
  const blurredAvatar = candPage.locator('img[data-rung1-avatar]').first();
  await expect(blurredAvatar).toBeVisible({ timeout: 15_000 });
  await expect(blurredAvatar).toHaveClass(/blur-\[8px\]/);

  // Open the detail sheet (tap the active card) so the detail surface is exercised too.
  await candPage.getByRole('button', { name: /tap to read the full plan/i }).click();
  await expect(candPage.getByText(/swiping on the night/i)).toBeVisible({ timeout: 15_000 });
  // Same hint on the detail sheet.
  await expect(candPage.getByText(/maya[^,]*,\s*\d+/i).first()).toBeVisible();

  // Privacy invariant across feed + detail: no clear host photo was ever signed.
  assertNoClearPhotoSigned(signed);

  await candContext.close();
});
