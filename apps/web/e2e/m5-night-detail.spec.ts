import { test, expect } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

let seed: SeedResult;
test.beforeAll(async () => { seed = await seedTwoUsersAndNight(); });
test.afterAll(async () => { if (seed) await cleanup(seed); });

test('M5: tapping a feed card opens the full blind-safe detail', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await loginAs(ctx, seed.candEmail);

  await page.goto('/feed');
  // The active card is a button (tap-to-read). Open the detail sheet.
  const card = page.getByRole('button', { name: /tap to read the full plan/i });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  // Real itinerary detail renders inside the sheet.
  await expect(page.getByText(/the train station pub/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/split the charcuterie/i)).toBeVisible();
  await expect(page.getByText(/the story/i)).toBeVisible();
  await expect(page.getByText(/walkable, low-key/i)).toBeVisible();
  await expect(page.getByText(/around \$56 each/i)).toBeVisible();

  // BLIND CONTRACT: no host identity / de-anon link leaks into the DOM.
  await expect(page.getByText(/the-secret-host/i)).toHaveCount(0); // reservation_url scrubbed
  const html = await page.content();
  expect(html).not.toContain('instagram.com/the-secret-host');
  expect(html).not.toContain(seed.hostId); // creator id never shipped
  // (host display name also absent — the seed sets no public host name on this surface)

  // Can swipe from inside the sheet.
  await page.getByRole('button', { name: /interested/i }).last().click();

  await ctx.close();
});
