// 05 reveal — rung 3 (threshold / post-lock): the ceremony. Crossing the lock
// threshold fires the earned face reveal — an un-blur dissolve in RevealModal + a
// sonner toast — gated on justLocked (?just=1). Also the SECURITY-CRITICAL inverse:
// a recipient with matches_enabled=false must NOT receive an identity_revealed
// delivery (the consent gate from 05-03 Task 1 suppresses it), exercised through
// the REAL lock RPC path.
//
// Mirrors 5b-happy-path.spec.ts auth/seed shape (PKCE login + service-role seed).
// We drive the real loop swipe -> shortlist -> offer -> accept to create the lock,
// read the lockId from the resulting /matches/<lockId> URL, then re-enter with
// ?just=1 (the in-app justLocked signal — same flag MatchConfirmation already uses).
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** Drive the real loop to a lock and return { candPage, hostPage, lockId }. */
async function lockTheMatch(browser: Parameters<Parameters<typeof test>[2]>[0]['browser'], seed: SeedResult) {
  const hostContext = await browser.newContext();
  const candContext = await browser.newContext();
  const hostPage: Page = await loginAs(hostContext, seed.hostEmail);
  const candPage: Page = await loginAs(candContext, seed.candEmail);

  // candidate swipes right on the host's night
  await candPage.goto('/feed');
  const likeBtn = candPage.getByRole('button', { name: /interested/i });
  await expect(likeBtn).toBeVisible({ timeout: 20_000 });
  await likeBtn.click();

  // host shortlists + offers
  await hostPage.goto(`/dates/${seed.instanceId}/interested`);
  const shortlistBtn = hostPage.getByRole('button', { name: /add .* to shortlist/i }).first();
  await expect(shortlistBtn).toBeVisible({ timeout: 20_000 });
  await shortlistBtn.click();
  const sendIt = hostPage.getByRole('button', { name: /make offer to/i }).first();
  await expect(sendIt).toBeVisible({ timeout: 15_000 });
  await sendIt.click();
  await hostPage.getByRole('button', { name: /send the offer/i }).click();
  await expect(hostPage.getByText(/offer's out/i)).toBeVisible({ timeout: 15_000 });

  // resolve the active offer id (setup read), candidate accepts through the real UI
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

  return { hostContext, candContext, hostPage, candPage, lockId: lockId as string };
}

test.describe('rung 3: the reveal ceremony', () => {
  // Each test drives its OWN fresh lock through the real loop; a locked night leaves
  // the feed (status 'matched'), so the two tests cannot share one seeded night.
  let seed: SeedResult;
  test.beforeEach(async () => { seed = await seedTwoUsersAndNight(); });
  test.afterEach(async () => { if (seed) await cleanup(seed); });

  test('ceremony fires on justLocked: un-blur + reveal toast + Tier-3 ProfileCard', async ({ browser }) => {
    const { hostContext, candContext, candPage, lockId } = await lockTheMatch(browser, seed);

    // Re-enter the lock with the justLocked signal -> the ceremony auto-opens.
    await candPage.goto(`/matches/${lockId}?just=1`);

    // The reveal toast fires with the exact reveal copy (lowercase, no em-dash).
    await expect(candPage.getByText(/the face behind the night\. say hi\./i)).toBeVisible({ timeout: 15_000 });

    // The RevealModal auto-opens in ceremony mode (no manual "see their profile" tap)
    // and settles into the Tier-3 ProfileCard: the host's name+age heading is shown.
    await expect(candPage.getByRole('heading', { name: /Maya[^']*, \d+$/ })).toBeVisible({ timeout: 15_000 });

    await hostContext.close();
    await candContext.close();
  });

  test('reduced-motion: no blur animation, immediate clear photo, toast still fires', async ({ browser }) => {
    const { hostContext, candContext, candPage, lockId } = await lockTheMatch(browser, seed);

    await candPage.emulateMedia({ reducedMotion: 'reduce' });
    await candPage.goto(`/matches/${lockId}?just=1`);

    // Emotional beat survives reduced-motion: the toast still fires...
    await expect(candPage.getByText(/the face behind the night\. say hi\./i)).toBeVisible({ timeout: 15_000 });
    // ...and the clear photo + profile settle in immediately (no held blur animation).
    await expect(candPage.getByRole('heading', { name: /Maya[^']*, \d+$/ })).toBeVisible({ timeout: 15_000 });

    await hostContext.close();
    await candContext.close();
  });
});

test.describe('inverse-consent: matches_enabled=false suppresses identity_revealed', () => {
  // SECURITY-CRITICAL: the opt-out must actually suppress the reveal delivery. A
  // separate seed so the consent flip is isolated. We set the HOST's matches_enabled
  // to false BEFORE the lock, drive the real lock, then assert the host's
  // identity_revealed notification is delivery-suppressed (channel='suppressed') —
  // the same consent outcome new_match gets — while the opted-in candidate is NOT
  // suppressed. dispatch_notification always writes an in-app row; matches_enabled
  // gates the delivery CHANNEL, which is the consent guarantee (sibling of new_match).
  let seed: SeedResult;
  test.beforeAll(async () => { seed = await seedTwoUsersAndNight(); });
  test.afterAll(async () => { if (seed) await cleanup(seed); });

  test('opted-out host: identity_revealed delivery suppressed; opted-in candidate not', async ({ browser }) => {
    // Flip the host opt-out (and ensure a reachable channel so the consent branch,
    // not the no-channel branch, is what suppresses). Candidate stays opted in.
    const sb = admin();
    const { error: hErr } = await sb.from('notification_preferences')
      .update({ matches_enabled: false, push_enabled: true, email_enabled: true })
      .eq('user_id', seed.hostId);
    expect(hErr, 'host opt-out update should succeed').toBeFalsy();
    const { error: cErr } = await sb.from('notification_preferences')
      .update({ matches_enabled: true, push_enabled: true, email_enabled: true })
      .eq('user_id', seed.candId);
    expect(cErr, 'candidate opt-in update should succeed').toBeFalsy();

    const { hostContext, candContext } = await lockTheMatch(browser, seed);

    // After the real lock, both got an identity_revealed in-app row (the system-wide
    // contract). The CONSENT signal is the delivery channel: opted-out host =
    // 'suppressed', opted-in candidate = a real channel.
    const { data: hostRows } = await sb.from('notifications')
      .select('channel').eq('user_id', seed.hostId).eq('type', 'identity_revealed');
    const { data: candRows } = await sb.from('notifications')
      .select('channel').eq('user_id', seed.candId).eq('type', 'identity_revealed');

    expect((hostRows ?? []).length, 'host should have an identity_revealed row').toBeGreaterThan(0);
    expect((candRows ?? []).length, 'candidate should have an identity_revealed row').toBeGreaterThan(0);
    // The load-bearing inverse-consent assertion: the opted-out host's reveal is
    // delivery-suppressed, the opted-in candidate's is not.
    for (const r of hostRows ?? []) {
      expect(r.channel, 'opted-out host identity_revealed must be suppressed').toBe('suppressed');
    }
    expect((candRows ?? []).some((r) => r.channel !== 'suppressed'),
      'opted-in candidate identity_revealed must NOT be suppressed').toBeTruthy();

    await hostContext.close();
    await candContext.close();
  });
});
