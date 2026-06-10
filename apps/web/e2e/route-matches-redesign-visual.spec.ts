// matches-redesign visual-capture — throwaway CAPTURE spec for the /matches
// dates-tab redesign (tab shell + upcoming/past sections + real cards + empty
// state). Mirrors route-07-visual.spec.ts: guarded behind CAPTURE_VISUAL=1, run
//   CI=1 CAPTURE_VISUAL=1 pnpm --filter @after5/web exec playwright test e2e/matches-redesign-visual.spec.ts
// Seeds via _helpers/seed (service-role SETUP writes only; the page read runs
// under the candidate's own RLS client). PNGs land in /tmp for the critique.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import {
  seedTwoUsersAndNight,
  seedChatThread,
  cleanup,
  cleanupChat,
  type ChatSeedResult,
} from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const VIEWPORT = { width: 420, height: 900 };

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Promote the seeded chat thread to an ACTIVE lock on the (future-dated) night —
// the upcoming card. Mirrors route-07's promoteThreadToLock.
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

// A SECOND night for the same pair, dated yesterday and completed, so the past
// section renders a ratable card (rating window: starts_at + 150min + 2h grace —
// long open by now). Returns ids for teardown.
async function seedCompletedPastLock(seed: ChatSeedResult): Promise<{ instanceId: string; lockId: string }> {
  const sb = admin();
  const { data: city, error: cityErr } = await sb.from('cities').select('id').eq('slug', 'kelowna').single();
  if (cityErr || !city) throw new Error(`cities: ${cityErr?.message}`);

  const { data: itin, error: itinErr } = await sb
    .from('itineraries')
    .insert({
      user_id: seed.hostId,
      inputs: { e2e: true },
      stops: [{ place_name: 'Pottery Studio', place_type: 'activity', start_time: '19:00', duration_min: 90 }],
      title: 'pottery + wine on the patio',
      hook: 'get messy',
      why_it_works: 'hands busy, talk easy',
      total_cost_pp: 40,
      total_duration_min: 150,
      pay_setting: 'split',
      city_id: city.id,
      is_public: false,
      vibe_tags: ['creative', 'boozy'],
    })
    .select('id')
    .single();
  if (itinErr || !itin) throw new Error(`itineraries (past): ${itinErr?.message}`);

  const startsAt = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const { data: inst, error: instErr } = await sb
    .from('date_instances')
    .insert({
      itinerary_id: itin.id,
      creator_id: seed.hostId,
      city_id: city.id,
      starts_at: startsAt,
      duration_min: 150,
      status: 'completed',
    })
    .select('id')
    .single();
  if (instErr || !inst) throw new Error(`date_instances (past): ${instErr?.message}`);

  const { data: lock, error: lockErr } = await sb
    .from('locks')
    .insert({
      date_instance_id: inst.id,
      creator_id: seed.hostId,
      matched_user_id: seed.candId,
      status: 'completed',
      locked_at: startsAt,
    })
    .select('id')
    .single();
  if (lockErr || !lock) throw new Error(`locks (past): ${lockErr?.message}`);
  return { instanceId: inst.id as string, lockId: lock.id as string };
}

// Prettify the seeded fixtures so the capture reads like the real app: plain
// first names (no run-id suffix) + a believable night title.
async function prettify(seed: ChatSeedResult): Promise<void> {
  const sb = admin();
  await sb.from('profiles').update({ first_name: 'Maya' }).eq('id', seed.hostId);
  await sb.from('profiles').update({ first_name: 'Jordan' }).eq('id', seed.candId);
  // run-id title varies — retitle the host's seeded "E2E night <runId>" itinerary.
  await sb.from('itineraries').update({ title: 'jazz bar + late night ramen' }).eq('user_id', seed.hostId).like('title', 'E2E night %');
}

const RUN = process.env.CAPTURE_VISUAL === '1';

test.describe('matches redesign visual-capture @420px (forced-local, CAPTURE_VISUAL=1)', () => {
  test.skip(!RUN, 'set CAPTURE_VISUAL=1 to run the visual-capture spec');
  test.use({ viewport: VIEWPORT });

  test('dates tab: upcoming + past sections, rate CTA, tab shell', async ({ browser }) => {
    const seed = await seedChatThread();
    let past: { instanceId: string; lockId: string } | null = null;
    try {
      await promoteThreadToLock(seed);
      past = await seedCompletedPastLock(seed);
      await prettify(seed);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await candPage.goto('/matches');
      expect(candPage.url(), '/matches bounced to /login → seed/login failed').not.toContain('/login');

      await expect(candPage.getByRole('heading', { name: 'upcoming' })).toBeVisible({ timeout: 20_000 });
      await expect(candPage.getByRole('heading', { name: 'past' })).toBeVisible();
      await expect(candPage.getByRole('link', { name: /rate it/i })).toBeVisible();
      // tab shell present with the dates tab active
      await expect(candPage.getByRole('navigation', { name: 'primary' })).toBeVisible();
      await candPage.waitForTimeout(800);
      await candPage.screenshot({ path: '/tmp/matches-redesign.png' });
      await ctx.close();
    } finally {
      if (past) {
        const sb = admin();
        await sb.from('locks').delete().eq('id', past.lockId);
        await sb.from('locks').delete().eq('date_instance_id', seed.instanceId);
        await sb.from('date_instances').delete().eq('id', past.instanceId);
      }
      await cleanupChat(seed);
    }
  });

  // /matches/[lockId] redesign: the reveal is the hero. Reuses the SAME seed
  // shape as the dates-tab capture — an upcoming active lock (with chat thread)
  // and a past completed ratable lock — and shoots both detail states.
  test('match detail: upcoming payoff + past ratable', async ({ browser }) => {
    const seed = await seedChatThread();
    let past: { instanceId: string; lockId: string } | null = null;
    try {
      const upcomingLockId = await promoteThreadToLock(seed);
      past = await seedCompletedPastLock(seed);
      await prettify(seed);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);

      // — upcoming: hero polaroid, ONE primary (message), NO rate CTA pre-date —
      await candPage.goto(`/matches/${upcomingLockId}`);
      expect(candPage.url(), 'detail bounced to /login → seed/login failed').not.toContain('/login');
      await expect(candPage.getByRole('heading', { level: 1, name: /maya/i })).toBeVisible({ timeout: 20_000 });
      await expect(candPage.getByRole('link', { name: /message maya/i })).toBeVisible();
      await expect(candPage.getByRole('button', { name: /see their profile/i })).toBeVisible();
      await expect(candPage.getByRole('link', { name: /rate this date/i })).toHaveCount(0);
      // the night rides the instance embed
      await expect(candPage.getByText('jazz bar + late night ramen')).toBeVisible();
      // tab shell present with a back affordance — never a dead end
      await expect(candPage.getByRole('navigation', { name: 'primary' })).toBeVisible();
      await expect(candPage.getByRole('link', { name: /back to matches/i })).toBeVisible();
      // viewport capture (not fullPage): fixed bottom nav paints mid-page on
      // fullPage shots — the @420px viewport is the honest read.
      await candPage.waitForTimeout(800);
      await candPage.screenshot({ path: '/tmp/match-detail.png' });
      await candPage.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }));
      await candPage.waitForTimeout(400);
      await candPage.screenshot({ path: '/tmp/match-detail-night.png' });

      // — past ratable: rate CTA exists ONLY now —
      await candPage.goto(`/matches/${past.lockId}`);
      await expect(candPage.getByRole('link', { name: /rate this date/i })).toBeVisible({ timeout: 20_000 });
      await expect(candPage.getByText('pottery + wine on the patio')).toBeVisible();
      await candPage.waitForTimeout(800);
      await candPage.screenshot({ path: '/tmp/match-detail-ratable.png' });
      await ctx.close();
    } finally {
      if (past) {
        const sb = admin();
        await sb.from('locks').delete().eq('id', past.lockId);
        await sb.from('locks').delete().eq('date_instance_id', seed.instanceId);
        await sb.from('date_instances').delete().eq('id', past.instanceId);
      }
      await cleanupChat(seed);
    }
  });

  test('dates tab: empty state', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await candPage.goto('/matches');
      await expect(candPage.getByText('no matches yet.')).toBeVisible({ timeout: 20_000 });
      await expect(candPage.getByRole('link', { name: /browse tonight's nights/i })).toBeVisible();
      await candPage.waitForTimeout(500);
      await candPage.screenshot({ path: '/tmp/matches-redesign-empty.png' });
      await ctx.close();
    } finally {
      await cleanup(seed);
    }
  });
});
