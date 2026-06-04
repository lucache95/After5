// E10 feed filters (REQ-E10): the searcher-facing filter loop, forced-local.
//   seed a host (woman) + a matching searcher (man, prefs include women) + a seeking
//   night → searcher sees the night in the feed → opens the FilterSheet and sets a
//   HARD filter that hides it (who's hosting = men, but the host is a woman) → the
//   filtered-empty recovery names the filter + offers a one-tap loosen → loosening
//   (open it to everyone) re-queries and the night returns.
//
// Selectors match the REAL DOM (committed 2026-06-04):
//   - feed gear trigger = button aria-label "filters" (SwipeDeck header)
//   - quick chips = buttons "<label>. tap to open filters" (SwipeDeck)
//   - FilterSheet groups = headings "dealbreakers" / "nice to have"; option chips
//     role=checkbox/radio with the field labels (who's hosting "men", etc.)
//   - apply CTA = button "apply filters"
//   - filtered-empty = "nothing fits those filters." + an accent loosen button
//   - genuinely-empty (unfiltered) = "that's everyone for now."
//
// The night is the only seeded card, so the feed has exactly one before filtering
// and zero after — a deterministic filtered-empty state.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

let seed: SeedResult;

test.beforeAll(async () => {
  seed = await seedTwoUsersAndNight();
});
test.afterAll(async () => {
  if (seed) await cleanup(seed);
});

test('e10: filter hides the night → filtered-empty recovery → loosen recovers', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 420, height: 880 } });
  // The candidate (man, prefs woman) is the searcher; the seeded host is a woman.
  const page: Page = await loginAs(context, seed.candEmail);

  // 1. Unfiltered feed: the seeded night shows; quick chips render inactive.
  await page.goto('/feed');
  await expect(page.getByRole('button', { name: /interested/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('group', { name: /quick filters/i })).toBeVisible();

  // 2. Open the FilterSheet via the gear, set a HARD filter that hides the woman host.
  await page.getByRole('button', { name: /^filters$/i }).click();
  await expect(page.getByRole('heading', { name: 'dealbreakers' })).toBeVisible();
  await page.getByRole('checkbox', { name: /^men$/i }).click();
  await page.getByRole('button', { name: /apply filters/i }).click();

  // 3. The feed re-queries to empty → filtered-empty recovery (NOT the funny copy).
  await expect(page.getByText(/nothing fits those filters/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/that.s everyone for now/i)).toHaveCount(0);
  const loosen = page.getByRole('button', { name: /open it to everyone/i });
  await expect(loosen).toBeVisible();

  // 4. Loosen → feed_filters drops the hard filter, re-queries → the night returns.
  await loosen.click();
  await expect(page.getByRole('button', { name: /interested/i })).toBeVisible({ timeout: 20_000 });

  await context.close();
});
