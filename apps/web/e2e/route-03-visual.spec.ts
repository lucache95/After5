// route-03-visual.spec.ts — QA CAPTURE ONLY (no assertions about visual quality).
// Renders three dating-loop screens against the FORCED-LOCAL stack at 420px width and
// saves full-page screenshots. Matched by testMatch /(…|route-)…/ in playwright.config.
// MUST run with CI=1 so Playwright spawns its own LOCAL-pointed dev server (reuseExistingServer:false).
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { seedChatThread, type ChatSeedResult } from './_helpers/seed';
import { loginAs } from './_helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';

const OUT_DIR = 'e2e/__screenshots__/03-visual';

// 420px-wide phone viewport (the design target; desktop centers in a max-w-[420px] shell).
test.use({ viewport: { width: 420, height: 900 } });

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Minimal promoted-profile user creator (mirrors seed.ts createUser+promoteProfile).
async function makeCandidate(
  sb: ReturnType<typeof admin>,
  cityId: string,
  firstName: string,
  birthdate: string,
): Promise<string> {
  const email = `xtra+${Math.random().toString(36).slice(2)}@e2e.local`;
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`makeCandidate ${email}: ${error?.message}`);
  const uid = data.user.id;
  let r = await sb.from('profiles_private').upsert({ user_id: uid, birthdate }, { onConflict: 'user_id' });
  if (r.error) throw new Error(`profiles_private ${uid}: ${r.error.message}`);
  r = await sb
    .from('profiles')
    .update({
      first_name: firstName,
      gender: 'woman',
      gender_preferences: ['man', 'woman'],
      age_pref: '[25,45)',
      primary_city_id: cityId,
      distance_pref_km: 40,
      vibe_tags: ['cozy', 'creative'],
      clear_photo_url: '/places/place-walk.jpg',
      blurred_photo_url: '/places/place-walk.jpg',
      verification: 'verified',
      dating_enabled: true,
      onboarding_step: 'done',
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('id', uid);
  if (r.error) throw new Error(`profiles ${uid}: ${r.error.message}`);
  return uid;
}

let seed: ChatSeedResult;
let lockId: string;
const seededStatuses: Record<string, string> = {};

test.beforeAll(async () => {
  // Hard fail loudly if the env points anywhere but local — prod protection.
  if (!SUPABASE_URL.includes('127.0.0.1')) {
    throw new Error(`REFUSING to seed: SUPABASE_URL is not local (${SUPABASE_URL})`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sb = admin();
  // Screen #1 base: active offer host(Maya)→cand(Jordan) + open thread + outsider.
  seed = await seedChatThread();

  const { data: city } = await sb.from('cities').select('id').eq('slug', 'kelowna').single();
  const cityId = (city!.id) as string;

  // --- Extra candidates for the rich INTERESTED list -----------------------
  const u_interested1 = await makeCandidate(sb, cityId, 'Avery', '1994-03-03');
  const u_interested2 = await makeCandidate(sb, cityId, 'Casey', '1993-07-07');
  const u_passed = await makeCandidate(sb, cityId, 'Devon', '1991-11-11');
  const u_expired = await makeCandidate(sb, cityId, 'Emery', '1996-01-15');
  const u_locked = await makeCandidate(sb, cityId, 'Frankie', '1990-08-08');
  const u_passed_by_host = await makeCandidate(sb, cityId, 'Gray', '1992-12-12');

  // queue_entries.status/rank are normally only writable by the match RPCs; service-role
  // bypasses RLS for SETUP. The active-offer candidate is Jordan (seed.candId) so the
  // page's activeOffer lines up with the queue row (rank 1, frozen "offer out" slot).
  const rows = [
    { candidate_id: seed.candId, status: 'offer_active', rank: 1 },   // Jordan — frozen, withdraw + offer-out
    { candidate_id: u_locked, status: 'locked', rank: 2 },             // accepted pill
    { candidate_id: u_passed, status: 'offer_passed', rank: 3 },       // "they passed"
    { candidate_id: u_expired, status: 'offer_expired', rank: 4 },     // "expired"
    { candidate_id: u_interested1, status: 'interested', rank: null }, // new-interest + decline control
    { candidate_id: u_interested2, status: 'interested', rank: null },
    { candidate_id: u_passed_by_host, status: 'passed_by_host', rank: 9 }, // MUST be filtered out
  ];
  for (const row of rows) {
    const { error } = await sb.from('queue_entries').insert({
      date_instance_id: seed.instanceId,
      candidate_id: row.candidate_id,
      creator_id: seed.hostId,
      status: row.status,
      rank: row.rank,
    });
    if (error) throw new Error(`queue_entries ${row.status}: ${error.message}`);
    seededStatuses[row.status] = row.candidate_id;
  }

  // --- LOCK row: host(creator) + Jordan(matched) on the same night --------
  // lock_status enum value is 'active'. date_instances must move to 'matched'
  // (date_match_status enum has no 'locked') so the night reads as locked.
  // The lock_participants sync trigger needs the instance time_range (already set
  // via duration_min in the base seed), so insert the lock AFTER the instance exists.
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

  // Back-reference the open chat thread to the lock so the LockDetail thread embed
  // (chat_threads_lock_id_fkey) resolves and the "message" affordance renders.
  await sb.from('chat_threads').update({ lock_id: lockId }).eq('id', seed.threadId);
});

test('capture three dating-loop screens at 420px', async ({ browser }) => {
  const consoleLog: string[] = [];
  const errLog: string[] = [];

  // ---- Candidate POV: /offers/{offerId} and /matches/{lockId} -------------
  const candCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const candPage = await loginAs(candCtx, seed.candEmail);
  candPage.on('console', (m) => { if (m.type() === 'error') consoleLog.push(`[offer/lock console] ${m.text()}`); });
  candPage.on('pageerror', (e) => errLog.push(`[offer/lock pageerror] ${e.message}`));

  // Screen 1: offer (candidate)
  await candPage.goto('/offers/' + seed.offerId);
  expect(candPage.url(), 'offer page bounced to /login → seed/login failed').not.toContain('/login');
  // PlanTimeline renders the rich stop "The Train Station Pub".
  await candPage.getByText(/the train station pub/i).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await candPage.waitForTimeout(1200);
  await candPage.screenshot({ path: `${OUT_DIR}/01-offer-candidate.png`, fullPage: true });

  // Screen 2: lock (candidate is matched_user → participant)
  await candPage.goto('/matches/' + lockId);
  expect(candPage.url(), 'lock page bounced to /login').not.toContain('/login');
  await candPage.getByText(/the train station pub/i).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await candPage.waitForTimeout(1200);
  await candPage.screenshot({ path: `${OUT_DIR}/02-lock.png`, fullPage: true });

  // ---- Host POV: /dates/{instanceId}/interested --------------------------
  const hostCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const hostPage = await loginAs(hostCtx, seed.hostEmail);
  hostPage.on('console', (m) => { if (m.type() === 'error') consoleLog.push(`[interested console] ${m.text()}`); });
  hostPage.on('pageerror', (e) => errLog.push(`[interested pageerror] ${e.message}`));

  await hostPage.goto('/dates/' + seed.instanceId + '/interested');
  expect(hostPage.url(), 'interested page bounced to /login').not.toContain('/login');
  // Wait for the host header / a candidate row.
  await hostPage.getByText(/who's interested/i).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await hostPage.waitForTimeout(1200);
  await hostPage.screenshot({ path: `${OUT_DIR}/03-interested-host.png`, fullPage: true });

  // ---- Report collected diagnostics --------------------------------------
  console.log('\n==== SEEDED IDS ====');
  console.log('offerId   =', seed.offerId);
  console.log('lockId    =', lockId);
  console.log('instanceId=', seed.instanceId);
  console.log('queue statuses:', JSON.stringify(seededStatuses, null, 0));
  console.log('\n==== CONSOLE ERRORS ====');
  console.log(consoleLog.length ? consoleLog.join('\n') : '(none)');
  console.log('\n==== PAGE ERRORS ====');
  console.log(errLog.length ? errLog.join('\n') : '(none)');

  await candCtx.close();
  await hostCtx.close();
});
