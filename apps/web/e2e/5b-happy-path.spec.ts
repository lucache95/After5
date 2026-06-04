// 5b happy path (spec §4.5): two contexts (host + candidate) drive the real loop
// swipe → shortlist → offer → accept → reveal. Selectors match the REAL D/E/F DOM
// (verified against the committed components 2026-05-29):
//   - feed right-swipe = button aria-label "interested — slide this onto my list" (SwipeDeck)
//   - host route is /dates/[slug]/interested where [slug] carries the instance id (page.tsx)
//   - new-interest candidate = button aria-label "add <name> to shortlist" (InterestedList)
//   - rank-1 make-offer CTA = button "send it"; MakeOfferModal confirm = "send the offer"
//   - offer success toast = "offer's out to <name>"
//   - candidate offer screen header "you've got an offer"; expiry = role=timer; accept = "accept"
//   - lock reveal = "see their profile" button → RevealModal shows the counterpart name
// There is NO /offers index route, so we resolve the offer id via the service-role
// seed client (a setup READ, not a faked user read — the candidate still accepts
// through the real UI/edge).
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

let seed: SeedResult;

test.beforeAll(async () => {
  seed = await seedTwoUsersAndNight();
});
test.afterAll(async () => {
  if (seed) await cleanup(seed);
});

test('5b happy path: swipe → shortlist → offer → accept → reveal (two contexts)', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const candContext = await browser.newContext();

  const hostPage: Page = await loginAs(hostContext, seed.hostEmail);
  const candPage: Page = await loginAs(candContext, seed.candEmail);

  // 1. Candidate swipes right on the host's night (button is the accessible
  //    fallback for the drag gesture; it calls recordSwipe → match_ingest_interest).
  await candPage.goto('/feed');
  const likeBtn = candPage.getByRole('button', { name: /interested/i });
  await expect(likeBtn).toBeVisible({ timeout: 20_000 });
  await likeBtn.click();

  // 2. Host opens the interested list; the candidate appears (initial fetch or
  //    Realtime insert). Click the candidate's row to shortlist them.
  await hostPage.goto(`/dates/${seed.instanceId}/interested`);
  const shortlistBtn = hostPage.getByRole('button', { name: /add .* to shortlist/i }).first();
  await expect(shortlistBtn).toBeVisible({ timeout: 20_000 });
  await shortlistBtn.click();

  // 3. Host makes the offer to the rank-1 shortlisted candidate.
  const sendIt = hostPage.getByRole('button', { name: /make offer to/i }).first();
  await expect(sendIt).toBeVisible({ timeout: 15_000 });
  await sendIt.click();
  await hostPage.getByRole('button', { name: /send the offer/i }).click();
  await expect(hostPage.getByText(/offer's out/i)).toBeVisible({ timeout: 15_000 });

  // Resolve the freshly-created active offer id (setup read).
  let offerId: string | null = null;
  for (let i = 0; i < 20 && !offerId; i++) {
    const { data } = await admin()
      .from('offers')
      .select('id')
      .eq('date_instance_id', seed.instanceId)
      .eq('status', 'active')
      .maybeSingle();
    offerId = (data?.id as string | undefined) ?? null;
    if (!offerId) await new Promise((r) => setTimeout(r, 500));
  }
  expect(offerId, 'an active offer should exist after the host sends it').toBeTruthy();

  // 4. Candidate opens the offer, sees the countdown, accepts.
  await candPage.goto(`/offers/${offerId}`);
  await expect(candPage.getByText(/you've got an offer/i)).toBeVisible();
  await expect(candPage.getByRole('timer')).toBeVisible();
  await candPage.getByRole('button', { name: /^accept$/i }).click();

  // 5. Accept routes the candidate to /matches/<lockId>; both see the Tier-3 reveal.
  await expect(candPage).toHaveURL(/\/matches\//, { timeout: 20_000 });
  await candPage.getByRole('button', { name: /see their profile/i }).click();
  // The reveal modal's visible name heading ends with ", <age>" (e.g. "Maya …, 34");
  // the sr-only Drawer.Title ends with "'s profile" — anchor on the age suffix so we
  // match only the visible heading (the run-id may itself contain digits).
  await expect(candPage.getByRole('heading', { name: /Maya[^']*, \d+$/ })).toBeVisible({ timeout: 15_000 });

  // Host opens the match list, clicks into the lock, reveals the candidate.
  await hostPage.goto('/matches');
  await hostPage.getByRole('link', { name: /Jordan/i }).first().click();
  await expect(hostPage).toHaveURL(/\/matches\//);
  await hostPage.getByRole('button', { name: /see their profile/i }).click();
  await expect(hostPage.getByRole('heading', { name: /Jordan[^']*, \d+$/ })).toBeVisible({ timeout: 15_000 });

  // E16 (REQ-E16 / D-02): crossing the lock threshold dispatched identity_revealed
  // to BOTH parties at match_accept_offer. Assert a row exists for host AND candidate
  // (mirrors the notification-row reads elsewhere in the 5b suite). Covers the
  // accept (non-reciprocal) lock site; the reciprocal site is covered by the same
  // dispatch added in the 05-03 migration.
  let hostReveal = 0;
  let candReveal = 0;
  for (let i = 0; i < 20 && (hostReveal === 0 || candReveal === 0); i++) {
    const { count: hc } = await admin()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', seed.hostId)
      .eq('type', 'identity_revealed');
    const { count: cc } = await admin()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', seed.candId)
      .eq('type', 'identity_revealed');
    hostReveal = hc ?? 0;
    candReveal = cc ?? 0;
    if (hostReveal === 0 || candReveal === 0) await new Promise((r) => setTimeout(r, 500));
  }
  expect(hostReveal, 'host should receive an identity_revealed notification at lock').toBeGreaterThan(0);
  expect(candReveal, 'candidate should receive an identity_revealed notification at lock').toBeGreaterThan(0);

  await hostContext.close();
  await candContext.close();
});
