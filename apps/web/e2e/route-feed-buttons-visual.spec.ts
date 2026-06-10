// One-shot visual capture spec: heart vs. FAB differentiation audit.
// Run with:
//   CI=1 npx playwright test e2e/feed-buttons-visual.spec.ts --config playwright.config.ts
// Guards: only runs if CAPTURE_VISUAL=1
import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import {
  seedTwoUsersAndNight,
  cleanup,
  type SeedResult,
} from './_helpers/seed';

const VIEWPORT = { width: 420, height: 900 };
const OUT = '/tmp/feed-buttons.png';

const RUN = process.env.CAPTURE_VISUAL === '1';

test.describe('feed-buttons visual @420px (CAPTURE_VISUAL=1)', () => {
  test.skip(!RUN, 'set CAPTURE_VISUAL=1 to run');

  test('heart and + FAB are clearly distinct in one frame', async ({ browser }) => {
    let seed: SeedResult | null = null;
    try {
      seed = await seedTwoUsersAndNight();
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const page = await loginAs(ctx, seed.candEmail);

      await page.goto('/feed');
      // Wait for the like/heart button — the feed card is rendered
      await expect(page.getByRole('button', { name: /interested/i })).toBeVisible({ timeout: 25_000 });

      // Scroll so bottom-nav is visible and both buttons are in frame
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Short settle for framer-motion card entrance
      await page.waitForTimeout(600);

      await page.screenshot({ path: OUT });
      await ctx.close();
    } finally {
      if (seed) await cleanup(seed);
    }
  });
});
