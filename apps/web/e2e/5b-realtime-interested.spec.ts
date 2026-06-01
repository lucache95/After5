// 5b realtime — live queue_entries delivery to an IDLE host (task #60 verification).
// Companion to chat-happy-path (which proves live `messages` delivery): here the host
// opens their interested-list and just SITS there, then the candidate right-swipes in
// a separate context. The new candidate must appear on the host's page via a live
// postgres_changes push — NO reload. This exercises the full realtime stack for
// queue_entries: the socket carrying the viewer JWT (joinAuthed) + queue_entries in
// the supabase_realtime publication (20260601201000) + RLS queue_creator_read gating
// delivery to the host. Before those fixes the host's idle socket got zero rows.
//
// The live-appended row shows the placeholder name "someone new": the realtime payload
// carries only queue_entries columns, not the joined candidate profile (name/photo come
// from the server fetch on load). That placeholder IS the live-delivery signal — the
// real name fills in on the host's next load. We assert on it directly.
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

test('host interested-list updates live when a candidate swipes (no reload)', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const candContext = await browser.newContext();

  const hostPage: Page = await loginAs(hostContext, seed.hostEmail);
  const candPage: Page = await loginAs(candContext, seed.candEmail);

  // 1. Host opens the interested list and stays. Baseline: the page is loaded (so the
  //    subscribeQueueInserts effect has run) and the "new interest" pool is empty.
  await hostPage.goto(`/dates/${seed.instanceId}/interested`);
  await expect(hostPage.getByRole('heading', { name: /who's interested/i })).toBeVisible({ timeout: 20_000 });
  await expect(hostPage.getByText(/no new right-swipes yet/i)).toBeVisible();
  await expect(hostPage.getByRole('button', { name: /add .* to shortlist/i })).toHaveCount(0);

  // Let the realtime socket finish its authed JOIN before the insert fires, so we
  // genuinely test the live push (not a race where the row predates the channel).
  await hostPage.waitForTimeout(2000);

  // 2. Candidate right-swipes on the host's night in their own context. recordSwipe →
  //    match_ingest_interest inserts a queue_entry (creator_id = host, candidate_id = cand).
  await candPage.goto('/feed');
  const likeBtn = candPage.getByRole('button', { name: /interested/i });
  await expect(likeBtn).toBeVisible({ timeout: 20_000 });
  await likeBtn.click();

  // 3. The new candidate appears on the HOST's already-open page via realtime — no
  //    reload, no re-navigation. Live rows render as "someone new" until a fetch joins
  //    the profile. This is the push that delivered ZERO rows before the fixes.
  await expect(hostPage.getByRole('button', { name: /add someone new to shortlist/i }))
    .toBeVisible({ timeout: 20_000 });
  await expect(hostPage.getByText(/no new right-swipes yet/i)).toHaveCount(0);

  await hostContext.close();
  await candContext.close();
});
