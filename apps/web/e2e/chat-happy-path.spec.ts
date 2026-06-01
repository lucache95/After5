// chat happy path (Phase 7): two contexts (the offer's two parties) drive the real
// messaging loop — thread list → open conversation → send → counterpart sees it →
// reply → both see both → the soft "you've both said hi" nudge after each side has
// sent >= 1. Selectors match the REAL Phase 7 DOM (verified against the committed
// components 2026-06-01):
//   - /messages row = Link aria-label "chat with <counterpart first name>…" (ThreadList)
//   - conversation header = <h1> with the counterpart's first name (Conversation)
//   - composer textarea aria-label "message"; send button "send it" (Composer)
//   - bubbles render message.body; own/counterpart split via data-own (Bubble)
//   - nudge copy: "say hi before you lock in" -> "you've both said hi 👋" (Conversation)
// The offer + open chat thread are seeded directly (service-role SETUP write); the
// tests still read + send through the real authed clients + chat-send-message edge fn.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import { seedChatThread, cleanupChat, type ChatSeedResult } from './_helpers/seed';

let seed: ChatSeedResult;

test.beforeAll(async () => {
  seed = await seedChatThread();
});
test.afterAll(async () => {
  if (seed) await cleanupChat(seed);
});

// Full bidirectional realtime chat. Exercises the live postgres_changes path: the
// HOST's long-idle, already-open conversation must receive the candidate's reply with
// NO reload (line ~78). This was .fixme'd through two bugs, both now fixed: (1) the
// write-path grant (20260601100600), and (2) the realtime socket joining as anon —
// subscribeThreadMessages now setAuth's the session JWT onto the socket BEFORE
// subscribing (joinAuthed), so the RLS authorizer recognises the party member and
// delivers the insert. Without the fix the host received zero rows (3/3 deterministic).
test('chat happy path: list → open → send → reply → both see both + rapport nudge (two contexts)', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const candContext = await browser.newContext();

  // Host is the offer creator; their counterpart in the thread is the candidate (Jordan).
  // Candidate's counterpart is the host (Maya).
  const hostPage: Page = await loginAs(hostContext, seed.hostEmail);
  const candPage: Page = await loginAs(candContext, seed.candEmail);

  // 1. Host opens /messages and sees the thread (counterpart = candidate).
  await hostPage.goto('/messages');
  const hostRow = hostPage.getByRole('link', { name: new RegExp(`chat with ${seed.candName}`, 'i') });
  await expect(hostRow).toBeVisible({ timeout: 20_000 });

  // 2. Host opens the conversation; the header shows the counterpart's name; nudge is pre-hi.
  await hostRow.click();
  await expect(hostPage).toHaveURL(new RegExp(`/messages/${seed.threadId}`));
  await expect(hostPage.getByRole('heading', { name: new RegExp(seed.candName, 'i') })).toBeVisible();
  await expect(hostPage.getByText(/say hi before you lock in/i)).toBeVisible();

  // 3. Host sends a message; it appears in their own thread (own bubble).
  const hostMsg = `hi from host ${Date.now()}`;
  await hostPage.getByRole('textbox', { name: /message/i }).fill(hostMsg);
  await hostPage.getByRole('button', { name: /send it/i }).click();
  await expect(hostPage.getByText(hostMsg)).toBeVisible({ timeout: 15_000 });

  // 4. Candidate opens the conversation; they SEE the host's message (realtime, or on load).
  await candPage.goto(`/messages/${seed.threadId}`);
  await expect(candPage.getByRole('heading', { name: new RegExp(seed.hostName, 'i') })).toBeVisible();
  await expect(candPage.getByText(hostMsg)).toBeVisible({ timeout: 15_000 });

  // 5. Candidate replies; both contexts converge on both messages.
  const candMsg = `hi back from cand ${Date.now()}`;
  await candPage.getByRole('textbox', { name: /message/i }).fill(candMsg);
  await candPage.getByRole('button', { name: /send it/i }).click();
  await expect(candPage.getByText(candMsg)).toBeVisible({ timeout: 15_000 });
  await expect(candPage.getByText(hostMsg)).toBeVisible();

  // Host sees the candidate's reply (realtime push, no reload).
  await expect(hostPage.getByText(candMsg)).toBeVisible({ timeout: 15_000 });
  await expect(hostPage.getByText(hostMsg)).toBeVisible();

  // 6. Soft rapport nudge flips once EACH side has sent >= 1. Both views show it.
  await expect(hostPage.getByText(/you’ve both said hi/i)).toBeVisible({ timeout: 15_000 });
  await expect(candPage.getByText(/you’ve both said hi/i)).toBeVisible({ timeout: 15_000 });

  await hostContext.close();
  await candContext.close();
});
