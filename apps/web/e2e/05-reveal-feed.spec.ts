// 05 reveal — rung 1 (pre-match): the searcher senses a real person on the feed
// (blurred face + first name + age) but cannot judge the face. This spec carries the
// shared PRIVACY-INVARIANT network helper used across the reveal rungs:
//   every storage signed-photo request on a pre-lock surface MUST target a
//   *_blurred.jpg object — the clear photo path is NEVER signed pre-lock.
//
// Mirrors 5b-happy-path.spec.ts auth/seed shape (PKCE login + service-role seed).
// The visual rung-1 assertions (blurred avatar + {name, age} label) land in Task 4.
import { test, expect, type Page, type Request } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

// ─── shared privacy-invariant network helper ──────────────────────────────────
// Capture every Supabase storage sign request and remember the object path(s) each
// one asked to sign. On a pre-lock surface, asserting "no clear photo signed" reduces
// to "every signed path ends in _blurred.jpg" (the clear sibling is <uid>/<id>.jpg).
const SIGN_RE = /\/storage\/v1\/object\/sign(\/|\b)/;

/** Records signed object paths seen on `page`. Call before navigating. */
export function captureSignedPaths(page: Page): { paths: string[] } {
  const store = { paths: [] as string[] };
  page.on('request', (req: Request) => {
    const url = req.url();
    if (!SIGN_RE.test(url)) return;
    // Single-object sign: path is in the URL after /sign/. Batch sign (/sign-many or
    // createSignedUrls): the paths are in the POST body. Capture both shapes.
    const m = url.match(/\/storage\/v1\/object\/sign\/(.+?)(?:\?|$)/);
    if (m) store.paths.push(decodeURIComponent(m[1]));
    if (req.method() === 'POST') {
      try {
        const body = req.postDataJSON() as { paths?: string[]; path?: string } | null;
        if (body?.paths) store.paths.push(...body.paths);
        if (body?.path) store.paths.push(body.path);
      } catch {
        /* non-JSON body — ignore */
      }
    }
  });
  return store;
}

/** The load-bearing assertion: every signed photo path on a pre-lock surface is blurred. */
export function assertNoClearPhotoSigned(store: { paths: string[] }): void {
  const photoPaths = store.paths.filter((p) => /\.jpe?g$/i.test(p));
  for (const p of photoPaths) {
    expect(p, `pre-lock surface signed a non-blurred photo path: ${p}`).toMatch(/_blurred\.jpe?g$/i);
  }
}

let seed: SeedResult;

test.beforeAll(async () => {
  seed = await seedTwoUsersAndNight();
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

  // Open the detail sheet (tap the active card) so the detail surface is exercised too.
  await candPage.getByRole('button', { name: /tap to read the full plan/i }).click();
  await expect(candPage.getByText(/swiping on the night/i)).toBeVisible({ timeout: 15_000 });

  // Privacy invariant across feed + detail: no clear host photo was ever signed.
  assertNoClearPhotoSigned(signed);

  await candContext.close();
});
