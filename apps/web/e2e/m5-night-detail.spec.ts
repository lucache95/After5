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
  // Redesigned sheet: the hook renders as an italic line (no "the story" label);
  // the stop timeline lives under the "the night" label. Scope INSIDE the open
  // dialog — the aria-hidden swipe deck behind the sheet also says "night".
  await expect(page.getByRole('dialog').getByText('the night', { exact: true })).toBeVisible();
  // hook wins over why_it_works in the redesigned sheet (hookText fallback chain).
  await expect(page.getByText(/a slow burn/i)).toBeVisible();
  // cost renders as a "$56 pp" chip in the redesigned chip row.
  await expect(page.getByRole('dialog').getByText(/\$56 pp/i)).toBeVisible();

  // BLIND CONTRACT: no host identity / de-anon link leaks into the DOM.
  await expect(page.getByText(/the-secret-host/i)).toHaveCount(0); // reservation_url scrubbed
  const html = await page.content();
  expect(html).not.toContain('instagram.com/the-secret-host');
  expect(html).not.toContain(seed.hostId); // creator id never shipped
  // E15 progressive reveal: the host's FIRST NAME + age are the spec'd pre-lock
  // hint (browse_feed host_first_name/host_age), so "Maya" is allowed here now.
  // What must stay hidden pre-lock: the clear photo path and any de-anon vector.
  expect(html).not.toContain('clear_photo');

  // Can swipe from inside the sheet.
  await page.getByRole('button', { name: /interested/i }).last().click();

  await ctx.close();
});
