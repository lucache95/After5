// 06 visual-capture — the AUTOMATED half of the phase-gate visual-verify (06-05 Task 2).
// Renders the new Phase-6 trust-and-safety surfaces at the project's @420px mobile-first
// viewport against the forced-local stack and writes per-surface PNGs into the phase
// __visual__/ dir for the human critique (Task 2). Mirrors 05-visual-capture.spec.ts.
//
// This is a throwaway CAPTURE spec, NOT a behavioral assertion suite — the E17/E18/E19
// behavior lives in their own specs. It is GUARDED behind CAPTURE_VISUAL=1 so a bare
// `playwright test` (CI default set) skips it; run it explicitly with
//   CI=1 CAPTURE_VISUAL=1 SERVICE_ROLE_KEY=… \
//     pnpm --filter @after5/web exec playwright test e2e/06-visual-capture.spec.ts
// (CI=1 so Playwright spawns its own LOCAL-pointed dev server, reuseExistingServer:false.)
//
// Surfaces captured:
//   reliability-badge-new.png         — revealed ProfileCard, host reliability_score NULL → "new here" blush pill
//   reliability-badge-established.png — same surface, host reliability_score 94 → "94% · reliable" + sage tick
//   chat-nav-edges.png                — locked /messages/[threadId] header, the two right-slot nav controls
//   reconfirm-card.png                — LockDetail soft "still on?" reconfirm card (unacked date_reconfirm)
//   checkin-card.png                  — LockDetail soft "all good?" check-in card (unacked safety_checkin)
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedChatThread, cleanupChat, type ChatSeedResult } from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  // Local Supabase demo service-role JWT fallback (same as the 05-reveal / e18 specs) so the
  // spec is self-sufficient on the forced-local stack without exporting env first.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Project visual-verify standard: 420px-wide mobile-first viewport (the app centers in a
// max-w-[420px] phone container; capturing at this width is the canonical recipe).
const VIEWPORT = { width: 420, height: 900 };

// PNGs land in the phase dir for the Task-2 critique. process.cwd() is apps/web under
// `pnpm --filter @after5/web`, so walk up to the repo root.
const OUT_DIR = join(
  process.cwd(),
  '..',
  '..',
  '.planning',
  'phases',
  '06-trust-and-safety-p2',
  '__visual__',
);
mkdirSync(OUT_DIR, { recursive: true });
const out = (name: string) => join(OUT_DIR, name);

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Promote a seeded chat thread to a lock: flip the instance to matched, insert an active
// lock on the same instance + parties, and back-reference it from the thread. Mirrors the
// e18 lock-promotion seeding. Returns the lockId.
async function promoteThreadToLock(seed: ChatSeedResult): Promise<string> {
  const sb = admin();
  await sb.from('date_instances').update({ status: 'matched' }).eq('id', seed.instanceId);
  const { data: lock, error } = await sb
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
  if (error || !lock) throw new Error(`locks insert: ${error?.message}`);
  const lockId = lock.id as string;
  await sb.from('chat_threads').update({ lock_id: lockId }).eq('id', seed.threadId);
  return lockId;
}

// Seed the host's REAL clear photo + the profile_photos gallery row the reveal page signs,
// so the revealed ProfileCard shows a real face (not the held "pull to retry" fallback).
// Mirrors 05-visual-capture's seedHostClearPhoto. The clear object lives at '<uid>/<id>.jpg'.
async function seedHostClearPhoto(hostId: string): Promise<void> {
  const sb = admin();
  const id = randomUUID();
  const clearPath = `${hostId}/${id}.jpg`;
  const bytes = readFileSync(join(process.cwd(), 'public', 'places', 'place-walk.jpg'));
  const { error: upErr } = await sb.storage
    .from('profile-photos')
    .upload(clearPath, bytes, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw new Error(`seed clear upload: ${upErr.message}`);
  const { error: insErr } = await sb.from('profile_photos').insert({
    id,
    user_id: hostId,
    clear_path: clearPath,
    sort_order: 0,
    is_primary: true,
  });
  if (insErr) throw new Error(`seed clear photo row: ${insErr.message}`);
}

// Insert an unacked notification (read_at NULL) for the viewer on this lock, so the
// LockDetail loader derives reconfirmDue / checkinDue true (it scopes to user_id = viewer,
// type, and payload->>lock_id = lockId; see matches/[lockId]/page.tsx).
async function seedUnackedNotification(
  userId: string,
  lockId: string,
  type: 'date_reconfirm' | 'safety_checkin',
): Promise<void> {
  const sb = admin();
  const { error } = await sb.from('notifications').insert({
    user_id: userId,
    type,
    payload: { lock_id: lockId },
    delivered: true,
    read_at: null,
  });
  if (error) throw new Error(`seed ${type} notification: ${error.message}`);
}

// Open the revealed ProfileCard (the RevealModal) from LockDetail's "see their profile"
// button and wait for the card heading to settle, then screenshot it.
async function captureReveal(candPage: Page, lockId: string, file: string): Promise<void> {
  await candPage.goto(`/matches/${lockId}`);
  expect(candPage.url(), 'lock page bounced to /login → seed/login failed').not.toContain('/login');
  const seeProfile = candPage.getByRole('button', { name: /see their profile/i });
  await expect(seeProfile).toBeVisible({ timeout: 20_000 });
  await seeProfile.click();
  // The RevealModal (vaul drawer) renders the ProfileCard with the name+age heading.
  await expect(candPage.getByRole('heading', { name: /maya[^,]*,\s*\d+/i })).toBeVisible({ timeout: 15_000 });
  // Let the drawer slide-in + un-blur settle before the shot.
  await candPage.waitForTimeout(700);
  await candPage.screenshot({ path: out(file) });
}

// Guard: a bare `playwright test` (CI default set) must NOT run this capture spec.
const RUN = process.env.CAPTURE_VISUAL === '1';

test.describe('06 visual-capture @420px (forced-local, CAPTURE_VISUAL=1)', () => {
  test.skip(!RUN, 'set CAPTURE_VISUAL=1 to run the visual-capture spec');
  test.use({ viewport: VIEWPORT });

  test('E17 reliability badge — new member (blush "new here", no number)', async ({ browser }) => {
    const seed = await seedChatThread();
    try {
      const lockId = await promoteThreadToLock(seed);
      await seedHostClearPhoto(seed.hostId);
      // New member = verified (promoteProfile sets it) + reliability_score NULL → isNew true.
      await admin().from('profiles').update({ reliability_score: null }).eq('id', seed.hostId);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await captureReveal(candPage, lockId, 'reliability-badge-new.png');
      // Sanity: the blush "new here" treatment rendered (word-only, no number).
      await expect(candPage.getByText(/^new here$/i)).toBeVisible();
      await ctx.close();
    } finally {
      await cleanupChat(seed);
    }
  });

  test('E17 reliability badge — established (94% · reliable + sage tick)', async ({ browser }) => {
    const seed = await seedChatThread();
    try {
      const lockId = await promoteThreadToLock(seed);
      await seedHostClearPhoto(seed.hostId);
      // Established = verified + a concrete reliability_score → "{score}% · reliable".
      await admin().from('profiles').update({ reliability_score: 94 }).eq('id', seed.hostId);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await captureReveal(candPage, lockId, 'reliability-badge-established.png');
      // Sanity: the established pill rendered with the score.
      await expect(candPage.getByText(/94% · reliable/i)).toBeVisible();
      await ctx.close();
    } finally {
      await cleanupChat(seed);
    }
  });

  test('E18 chat nav edges — locked header exposes "their profile" + "the night"', async ({ browser }) => {
    const seed = await seedChatThread();
    try {
      const lockId = await promoteThreadToLock(seed);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const page = await loginAs(ctx, seed.candEmail);
      await page.goto(`/messages/${seed.threadId}`);
      expect(page.url(), 'conversation bounced to /login → seed/login failed').not.toContain('/login');
      // The conversation header renders the counterpart (Maya) + both reveal-gated controls.
      await expect(
        page.getByRole('banner').getByRole('heading', { name: new RegExp(seed.hostName, 'i') }),
      ).toBeVisible({ timeout: 20_000 });
      const toProfile = page.getByRole('link', { name: 'their profile' });
      const toNight = page.getByRole('link', { name: 'the night' });
      await expect(toProfile).toBeVisible();
      await expect(toProfile).toHaveAttribute('href', `/matches/${lockId}`);
      await expect(toNight).toBeVisible();
      await expect(toNight).toHaveAttribute('href', `/matches/${lockId}`);
      // Frame the header (with the right-slot controls) for the critique.
      await page.waitForTimeout(400);
      await page.screenshot({ path: out('chat-nav-edges.png') });
      await ctx.close();
    } finally {
      await cleanupChat(seed);
    }
  });

  test('E19 reconfirm — soft "still on?" card (unacked date_reconfirm)', async ({ browser }) => {
    const seed = await seedChatThread();
    try {
      const lockId = await promoteThreadToLock(seed);
      await seedHostClearPhoto(seed.hostId);
      // The viewer (cand) has a live, unread day-of reconfirm for THIS lock → reconfirmDue true.
      await seedUnackedNotification(seed.candId, lockId, 'date_reconfirm');

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await candPage.goto(`/matches/${lockId}`);
      expect(candPage.url(), 'lock page bounced to /login').not.toContain('/login');
      await expect(candPage.getByRole('heading', { name: /still on\?/i })).toBeVisible({ timeout: 20_000 });
      await expect(candPage.getByRole('button', { name: /yep, still on/i })).toBeVisible();
      await expect(candPage.getByRole('button', { name: /gotta bail/i })).toBeVisible();
      await candPage.waitForTimeout(400);
      await candPage.screenshot({ path: out('reconfirm-card.png') });
      await ctx.close();
    } finally {
      await cleanupChat(seed);
    }
  });

  test('E19 check-in — soft "all good?" card (unacked safety_checkin)', async ({ browser }) => {
    const seed = await seedChatThread();
    try {
      const lockId = await promoteThreadToLock(seed);
      await seedHostClearPhoto(seed.hostId);
      // The viewer (cand) has a live, unread post-date safety check-in for THIS lock → checkinDue true.
      await seedUnackedNotification(seed.candId, lockId, 'safety_checkin');

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await candPage.goto(`/matches/${lockId}`);
      expect(candPage.url(), 'lock page bounced to /login').not.toContain('/login');
      await expect(candPage.getByRole('heading', { name: /all good\?/i })).toBeVisible({ timeout: 20_000 });
      await expect(candPage.getByRole('button', { name: /^all good$/i })).toBeVisible();
      await expect(candPage.getByText(/something's wrong/i)).toBeVisible();
      await candPage.waitForTimeout(400);
      await candPage.screenshot({ path: out('checkin-card.png') });
      await ctx.close();
    } finally {
      await cleanupChat(seed);
    }
  });
});
