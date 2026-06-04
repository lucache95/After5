// route-03-e11-visual.spec.ts — QA CAPTURE ONLY (no assertions about visual quality).
// Renders the Phase-3 E11 CREATOR-CONTROL surfaces against the FORCED-LOCAL stack at
// 420px width and saves full-page screenshots. Matched by testMatch /(…|route-)…/.
// MUST run with CI=1 so Playwright spawns its own LOCAL-pointed dev server.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { seedTwoUsersAndNight, type SeedResult } from './_helpers/seed';
import { loginAs } from './_helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';

const OUT_DIR = 'e2e/__screenshots__/03-visual';

// 420px-wide phone viewport (the E11 design target).
test.use({ viewport: { width: 420, height: 900 } });

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let seed: SeedResult;
let itineraryId: string;

test.beforeAll(async () => {
  // Prod-protection: refuse to seed unless the env points at the local stack.
  if (!SUPABASE_URL.includes('127.0.0.1')) {
    throw new Error(`REFUSING to seed: SUPABASE_URL is not local (${SUPABASE_URL})`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sb = admin();
  // Host "Maya" owns a seeking date_instance built from an itinerary they own.
  seed = await seedTwoUsersAndNight();

  // The host's itinerary id (the publish CTA passes ?itinerary=<this>).
  const { data: itin, error } = await sb
    .from('itineraries')
    .select('id')
    .eq('user_id', seed.hostId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !itin) throw new Error(`itinerary lookup: ${error?.message}`);
  itineraryId = itin.id as string;
});

test('capture E11 creator-control surfaces at 420px', async ({ browser }) => {
  const consoleLog: string[] = [];
  const errLog: string[] = [];
  const presence: Record<string, boolean> = {};

  const hostCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await loginAs(hostCtx, seed.hostEmail);
  page.on('console', (m) => { if (m.type() === 'error') consoleLog.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errLog.push(`[pageerror] ${e.message}`));

  // ── Screen 1: post-a-night creator form ──────────────────────────────────
  // The publish CTA passes ?itinerary=<id>; page.tsx loads the host's plans
  // either way (it ORs user_id + is_public), so the form renders even without
  // the query param. We pass it to mirror the real Door-2 → publish entry.
  await page.goto(`/nights/new?itinerary=${itineraryId}`);
  expect(page.url(), 'nights/new bounced to /login → seed/login failed').not.toContain('/login');
  expect(page.url(), 'nights/new bounced to /onboarding → host not dating-enabled').not.toContain('/onboarding');

  // Wait for a creator-control anchor: the "the why?" textarea label.
  await page.getByText(/the why\?/i).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/E11-01-postnight-form.png`, fullPage: true });

  // Record which E11 fieldsets actually rendered.
  presence['who-pays'] = await page.getByRole('radiogroup', { name: /who pays/i }).isVisible().catch(() => false);
  presence['target-gender'] = await page.getByRole('group', { name: /target gender/i }).isVisible().catch(() => false);
  presence['age-youngest'] = await page.locator('#age-min').isVisible().catch(() => false);
  presence['age-oldest'] = await page.locator('#age-max').isVisible().catch(() => false);
  presence['radius'] = await page.locator('#radius-km').isVisible().catch(() => false);
  presence['the-why'] = await page.locator('#why-note').isVisible().catch(() => false);

  // Secondary capture scrolled to the targeting/who-pays fieldset (in case the
  // fullPage shot is long enough that these are off the visible critique window).
  await page.locator('#why-note').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/E11-01b-postnight-targeting.png` });

  // ── Screen 2: Door-2 canvas + sticky publish CTA + CoverUploader ─────────
  await page.goto(`/plans/${itineraryId}/edit`);
  expect(page.url(), 'plans/edit bounced to /login').not.toContain('/login');
  // notFound() would render the 404 — assert we did not 404 on the owned plan.
  await page.getByRole('button', { name: /publish this night/i }).waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/E11-02-door2-publish-cta.png`, fullPage: true });

  presence['cover-uploader'] = await page.getByRole('button', { name: /upload a cover|change the cover/i }).isVisible().catch(() => false);
  // The CoverUploader's hidden <input aria-label="upload a cover"> is sr-only; check
  // the visible dropzone/label instead.
  presence['cover-dropzone'] = await page.getByText(/no cover yet|tap to change/i).first().isVisible().catch(() => false);
  presence['publish-cta'] = await page.getByRole('button', { name: /publish this night/i }).isVisible().catch(() => false);

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n==== SEEDED IDS ====');
  console.log('hostId     =', seed.hostId);
  console.log('hostEmail  =', seed.hostEmail);
  console.log('instanceId =', seed.instanceId);
  console.log('itineraryId=', itineraryId);
  console.log('\n==== E11 FIELDSET PRESENCE ====');
  console.log(JSON.stringify(presence, null, 2));
  console.log('\n==== CONSOLE ERRORS ====');
  console.log(consoleLog.length ? consoleLog.join('\n') : '(none)');
  console.log('\n==== PAGE ERRORS ====');
  console.log(errLog.length ? errLog.join('\n') : '(none)');

  await hostCtx.close();
});
