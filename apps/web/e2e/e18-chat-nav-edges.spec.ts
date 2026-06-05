// e18-chat-nav-edges.spec.ts — E18 (REQ-E18): the 4 chat↔profile↔night nav edges.
// FORCED-LOCAL authed session (mirrors route-03-visual + chat-happy-path harness). The
// offer + open chat thread are seeded directly (service-role SETUP write, RLS bypassed for
// SETUP only); the assertions read through the real authed party client.
//
// The four edges:
//   1. Chat → Profile  : DeepRouteHeader right-slot Link, aria-label "their profile" -> /matches/<lockId>
//   2. Chat → Night    : DeepRouteHeader right-slot Link, aria-label "the night"     -> /matches/<lockId>
//   (1)+(2) are reveal-gated on lock_id — a PRE-LOCK thread (lock_id null) renders NEITHER.
//   3. Night → Profile : LockDetail "see their profile" button (existing, confirmed unchanged)
//   4. Night → Chat    : LockDetail "message <name>" link (existing, confirmed unchanged)
//
// MUST run with CI=1 so Playwright spawns its own LOCAL-pointed dev server
// (reuseExistingServer:false). Run in 06-05's forced-local pass.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedChatThread, cleanupChat, type ChatSeedResult } from './_helpers/seed';
import { loginAs } from './_helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';

// 420px-wide phone viewport (the design target; desktop centers in a max-w-[420px] shell).
test.use({ viewport: { width: 420, height: 900 } });

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let seed: ChatSeedResult;
// The pre-lock thread re-uses the same offer parties but a SEPARATE offer + thread with NO
// lock_id, to prove the reveal gate. lockId is the promoted-thread's lock.
let lockId: string;
let preLockThreadId: string;

test.beforeAll(async () => {
  if (!SUPABASE_URL.includes('127.0.0.1')) {
    throw new Error(`REFUSING to seed: SUPABASE_URL is not local (${SUPABASE_URL})`);
  }
  const sb = admin();
  seed = await seedChatThread();

  // Promote the seeded thread to a lock: insert a lock on the same instance + parties and
  // back-reference it from the thread (mirrors route-03-visual.spec lock seeding). The
  // date_instance must read as matched (date_match_status has no 'locked').
  await sb.from('date_instances').update({ status: 'matched' }).eq('id', seed.instanceId);
  const { data: lock, error: lockErr } = await sb
    .from('locks')
    .insert({
      date_instance_id: seed.instanceId,
      creator_id: seed.hostId,
      matched_user_id: seed.candId,
      status: 'active',
      locked_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (lockErr || !lock) throw new Error(`locks insert: ${lockErr?.message}`);
  lockId = lock.id as string;
  await sb.from('chat_threads').update({ lock_id: lockId }).eq('id', seed.threadId);

  // A second, PRE-LOCK thread (separate offer, lock_id stays null) to assert the reveal gate.
  const { data: offer2, error: offer2Err } = await sb
    .from('offers')
    .insert({
      date_instance_id: seed.instanceId,
      creator_id: seed.hostId,
      candidate_id: seed.candId,
      status: 'active',
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (offer2Err || !offer2) throw new Error(`pre-lock offer insert: ${offer2Err?.message}`);
  const { data: thread2, error: thread2Err } = await sb
    .from('chat_threads')
    .insert({ offer_id: offer2.id, state: 'open' })
    .select('id')
    .single();
  if (thread2Err || !thread2) throw new Error(`pre-lock thread insert: ${thread2Err?.message}`);
  preLockThreadId = thread2.id as string;
});

test.afterAll(async () => {
  if (seed) {
    const sb = admin();
    // Clear the extra pre-lock thread first (cleanupChat only knows the base thread).
    await sb.from('chat_threads').delete().eq('id', preLockThreadId);
    await cleanupChat(seed);
  }
});

test('E18: locked chat header exposes chat→profile + chat→night, both → the lock', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await loginAs(ctx, seed.candEmail);

  await page.goto(`/messages/${seed.threadId}`);
  expect(page.url(), 'conversation bounced to /login → seed/login failed').not.toContain('/login');
  // The conversation header renders (counterpart = Maya).
  await expect(page.getByRole('heading', { name: new RegExp(seed.hostName, 'i') })).toBeVisible({ timeout: 20_000 });

  // Edge 1: Chat → Profile. Icon-only control carries the aria-label and points at the lock.
  const toProfile = page.getByRole('link', { name: 'their profile' });
  await expect(toProfile).toBeVisible();
  await expect(toProfile).toHaveAttribute('href', `/matches/${lockId}`);

  // Edge 2: Chat → Night. Same lock target, distinct aria-label.
  const toNight = page.getByRole('link', { name: 'the night' });
  await expect(toNight).toBeVisible();
  await expect(toNight).toHaveAttribute('href', `/matches/${lockId}`);

  await ctx.close();
});

test('E18: a PRE-LOCK thread renders NEITHER nav control (reveal-gated, no identity leak)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await loginAs(ctx, seed.candEmail);

  await page.goto(`/messages/${preLockThreadId}`);
  expect(page.url(), 'pre-lock conversation bounced to /login').not.toContain('/login');
  await expect(page.getByRole('heading', { name: new RegExp(seed.hostName, 'i') })).toBeVisible({ timeout: 20_000 });

  // T-06-05: no profile/night control before the thread is lock-promoted.
  await expect(page.getByRole('link', { name: 'their profile' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'the night' })).toHaveCount(0);

  await ctx.close();
});

test('E18: LockDetail still exposes night→profile + night→chat (the two existing edges)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await loginAs(ctx, seed.candEmail);

  await page.goto(`/matches/${lockId}`);
  expect(page.url(), 'lock page bounced to /login').not.toContain('/login');

  // Edge 3: Night → Profile — the existing "see their profile" button (opens RevealModal).
  await expect(page.getByRole('button', { name: /see their profile/i })).toBeVisible({ timeout: 20_000 });

  // Edge 4: Night → Chat — the existing "message <name>" link back to the thread.
  const toChat = page.getByRole('link', { name: new RegExp(`message ${seed.hostName}`, 'i') });
  await expect(toChat).toBeVisible();
  await expect(toChat).toHaveAttribute('href', `/messages/${seed.threadId}`);

  await ctx.close();
});
