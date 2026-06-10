// route-onboarding-experience — ONBOARDING EXPERIENCE audit collector (2026-06-09).
// NOT a judgement suite: walks the cold landing → signup → full wizard → first feed
// as a brand-new user at 420×900, capturing a screenshot at every screen + state to
// /tmp/onboarding-audit/, plus a walk-log JSON (taps, fields, landed URLs, errors).
// Claude reviews the artifacts and writes the experience-audit report.
//
// Gated: set CAPTURE_ONBOARDING_AUDIT=1 (skipped otherwise, like the other capture specs).
// MUST run with CI=1 (Playwright spawns the forced-local dev server) + export
// SERVICE_ROLE_KEY from `supabase status -o env` so /auth/callback + /api/stats work:
//   CAPTURE_ONBOARDING_AUDIT=1 CI=1 SERVICE_ROLE_KEY=… npx playwright test \
//     e2e/route-onboarding-experience.spec.ts --reporter=line
//
// Service-role is used ONLY to (a) seed teaser-feed nights so the first-feed moment
// has real supply, and (b) hop walls that the local stack can't cross (Persona is
// not configured locally; SMS works ONLY when an uncommitted [auth.sms.test_otp]
// mapping for 250 555 0199 → 123456 is active in supabase/config.toml) AFTER the
// wall screen itself has been experienced and captured — same as route-11-audit-pass2.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const RUN = process.env.CAPTURE_ONBOARDING_AUDIT === '1';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  // Local Supabase demo service-role JWT fallback (same as the other audit specs).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const MAILPIT = 'http://127.0.0.1:54324';

const VIEWPORT = { width: 420, height: 900 };
const OUT = '/tmp/onboarding-audit';
mkdirSync(OUT, { recursive: true });

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---- walk log ---------------------------------------------------------------
interface LogEntry { shot: string; note: string; url: string; extra?: unknown }
const log: LogEntry[] = [];
let shotN = 0;
async function shot(page: Page, name: string, note: string, extra?: unknown) {
  shotN += 1;
  const file = `${String(shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true }).catch(() => {});
  log.push({ shot: file, note, url: new URL(page.url()).pathname + new URL(page.url()).search, extra });
}
// Today's-fix probe: per-step back chip (OnboardingShell renders it on steps 2–6 only).
async function chrome(page: Page) {
  return {
    backChip: await page.locator('button[aria-label="back"]').count(),
    logoutVisible: await page.getByRole('button', { name: /log out/i }).count(),
  };
}
const consoleErrors: { where: string; text: string }[] = [];
const netFailures: { where: string; url: string; status: number }[] = [];
function watch(page: Page, where: string) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push({ where, text: m.text().slice(0, 300) });
  });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !/favicon|apple-icon|icon\.svg|webmanifest|_next\/(static|webpack)/.test(u)) {
      netFailures.push({ where, url: u.slice(0, 200), status: r.status() });
    }
  });
}

// ---- Mailpit PKCE (same recipe as _helpers/auth.ts, but we walk /login in-page
// so the signup screens themselves get captured) -------------------------------
async function findVerifyUrl(context: BrowserContext, email: string): Promise<string> {
  const deadline = Date.now() + 25_000;
  const wanted = email.toLowerCase();
  while (Date.now() < deadline) {
    const listRes = await context.request.get(`${MAILPIT}/api/v1/messages?limit=20`);
    const list = (await listRes.json()) as { messages?: Array<{ ID: string; To: Array<{ Address: string }> }> };
    for (const m of list.messages ?? []) {
      if (!(m.To ?? []).some((t) => t.Address.toLowerCase() === wanted)) continue;
      const detailRes = await context.request.get(`${MAILPIT}/api/v1/message/${m.ID}`);
      const detail = (await detailRes.json()) as { HTML?: string; Text?: string };
      const body = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`;
      const match = body.match(/https?:\/\/[^"\s<]*auth\/v1\/verify\?token=pkce_[^"\s<]*/);
      if (match) return match[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`no PKCE link for ${email}`);
}

// ---- teaser-night seed (so the first-feed moment has real supply) -------------
const runId = Date.now().toString(36);
const seedHostIds: string[] = [];
const seedInstanceIds: string[] = [];

const NIGHTS = [
  { title: 'tacos, then a record-store crawl', hook: 'i know the guy with the good crates', vibes: ['foodie', 'chill'], cover: '/places/place-cafe.jpg', host: 'Maya', g: 'woman', bd: '1996-03-12', days: 2 },
  { title: 'sunset paddle + brewery patio', hook: 'golden hour on the water, then a flight', vibes: ['active', 'patio'], cover: '/places/place-brewery.jpg', host: 'Priya', g: 'woman', bd: '1994-07-02', days: 3 },
  { title: 'cocktails and a tiny jazz set', hook: 'the corner booth is ours', vibes: ['nightlife', 'cozy'], cover: '/places/place-cocktail-bar.jpg', host: 'Noah', g: 'man', bd: '1992-11-23', days: 4 },
  { title: 'bakery run + lakeside walk', hook: 'best croissant in town, fight me', vibes: ['casual', 'outdoors'], cover: '/places/place-bakery.jpg', host: 'Erin', g: 'woman', bd: '1998-01-30', days: 5 },
] as const;

async function seedTeaserNights() {
  const sb = admin();
  const { data: city } = await sb.from('cities').select('id').eq('slug', 'kelowna').single();
  if (!city) throw new Error('no kelowna city row');
  for (const [idx, n] of NIGHTS.entries()) {
    const email = `obx-host${idx}+${runId}@e2e.local`;
    const { data: u, error: uErr } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (uErr || !u.user) throw new Error(`seed host: ${uErr?.message}`);
    const uid = u.user.id;
    seedHostIds.push(uid);
    await sb.from('profiles_private').upsert({ user_id: uid, birthdate: n.bd }, { onConflict: 'user_id' });
    const { error: pErr } = await sb.from('profiles').update({
      first_name: n.host, gender: n.g, gender_preferences: ['man', 'woman', 'nonbinary'],
      age_pref: '[22,45)', primary_city_id: city.id, distance_pref_km: 40,
      vibe_tags: [...n.vibes],
      clear_photo_url: n.cover, blurred_photo_url: n.cover,
      verification: 'verified', dating_enabled: true,
      onboarding_step: 'done', onboarding_completed_at: new Date().toISOString(),
    }).eq('id', uid);
    if (pErr) throw new Error(`seed profile: ${pErr.message}`);
    const { data: itin, error: iErr } = await sb.from('itineraries').insert({
      user_id: uid, inputs: { audit: 'onboarding-experience' },
      stops: [{
        place_name: 'Downtown spot', place_type: 'restaurant', start_time: '19:00',
        duration_min: 90, estimated_cost_pp: 30, what_to_do: 'the good stuff',
        neighborhood: 'Downtown', lat: 49.888, lng: -119.496,
      }],
      title: n.title, hook: n.hook, why_it_works: 'walkable and easy',
      why_note: n.hook, total_cost_pp: 60, total_duration_min: 150,
      cover_image_url: n.cover, pay_setting: 'split', city_id: city.id,
      is_public: false, vibe_tags: [...n.vibes],
    }).select('id').single();
    if (iErr || !itin) throw new Error(`seed itinerary: ${iErr?.message}`);
    const { data: inst, error: dErr } = await sb.from('date_instances').insert({
      itinerary_id: itin.id, creator_id: uid, city_id: city.id,
      starts_at: new Date(Date.now() + n.days * 24 * 3600 * 1000).toISOString(),
      duration_min: 150, status: 'seeking', moderation_status: 'approved',
    }).select('id').single();
    if (dErr || !inst) throw new Error(`seed instance: ${dErr?.message}`);
    seedInstanceIds.push(inst.id as string);
  }
}

async function cleanupSeed() {
  const sb = admin();
  for (const id of seedInstanceIds) {
    await sb.from('offers').delete().eq('date_instance_id', id);
    await sb.from('date_instances').delete().eq('id', id);
  }
  for (const uid of seedHostIds) {
    await sb.from('itineraries').delete().eq('user_id', uid);
    await sb.auth.admin.deleteUser(uid).catch(() => {});
  }
}

// Fresh-funnel users created during the walk (cleaned up afterwards).
const walkUserEmails: string[] = [];
async function deleteWalkUsers() {
  const sb = admin();
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const email of walkUserEmails) {
    const u = list?.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) await sb.auth.admin.deleteUser(u.id).catch(() => {});
  }
}

test.describe('onboarding experience audit @420px (forced-local)', () => {
  test.skip(!RUN, 'set CAPTURE_ONBOARDING_AUDIT=1 to run the collector');
  test.use({ viewport: VIEWPORT });

  test.beforeAll(async () => {
    if (!SUPABASE_URL.includes('127.0.0.1')) {
      throw new Error(`REFUSING to seed: SUPABASE_URL not local (${SUPABASE_URL})`);
    }
    await seedTeaserNights();
  });

  test.afterAll(async () => {
    writeFileSync(join(OUT, 'walk-log.json'), JSON.stringify({ log, consoleErrors, netFailures }, null, 2));
    await deleteWalkUsers();
    await cleanupSeed();
  });

  // ============================================================================
  // WALK 1 — the virgin funnel: cold landing → signup → every wizard step →
  // done → first feed. Service-role hops ONLY after the wall is captured.
  // ============================================================================
  test('walk 1: cold landing to first feed', async ({ browser }) => {
    test.setTimeout(420_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    watch(page, 'walk1');
    const sb = admin();
    const email = `virgin+${runId}@e2e.local`;
    walkUserEmails.push(email);

    // -- 1. cold landing --------------------------------------------------------
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});
    const landingCtas = await page.locator('a, button').allInnerTexts();
    await shot(page, 'landing', 'cold landing /', { visibleCtas: landingCtas.filter(Boolean) });

    // -- 2. the signup path a new user would take: the big pink CTA -------------
    await page.locator('a[href="/onboarding"]').first().click(); // TAP 1
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await shot(page, 'login', 'tap 1: "let\'s go" → bounced to /login (signup == login form)');

    await page.getByRole('textbox', { name: /email/i }).fill(email); // TAP 2 + typing
    await page.getByRole('button', { name: /email me a (sign-in )?link/i }).click(); // TAP 3
    await expect(page.getByText(/sent a sign-in link/i)).toBeVisible();
    await shot(page, 'login-sent', 'tap 3: magic link sent — user must leave for their inbox');

    const verifyUrl = await findVerifyUrl(ctx, email);
    await page.goto(verifyUrl); // TAP 4 (the email link)
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'post-auth-landing', 'tap 4 (email link): where a brand-new user lands');

    // -- 3. STEP 1: welcome / age gate ------------------------------------------
    if (!page.url().includes('/onboarding/welcome')) await page.goto('/onboarding/welcome');
    await page.waitForLoadState('networkidle').catch(() => {});
    const ctaDisabledPreCheck = await page.getByRole('button', { name: /let's go/i }).isDisabled();
    const notNowHref = await page.locator('a', { hasText: 'not now' }).first().getAttribute('href');
    await shot(page, 'welcome', 'STEP 1 welcome/age gate, pristine (back chip must be ABSENT here)', { ctaDisabledPreCheck, notNowHref, ...(await chrome(page)) });
    await page.getByRole('checkbox').check(); // TAP 5
    await shot(page, 'welcome-checked', 'age box ticked, CTA arms');
    // careless double-tap on the CTA:
    const goBtn = page.getByRole('button', { name: /let's go|one sec/i });
    await goBtn.click(); // TAP 6
    await goBtn.click({ timeout: 1500 }).catch(() => {}); // second tap of the double-tap (may be disabled already)
    await page.waitForURL(/\/onboarding\/basics/, { timeout: 15_000 });

    // -- 4. STEP 2: basics -------------------------------------------------------
    await page.waitForLoadState('networkidle').catch(() => {});
    const nextDisabledEmpty = await page.getByRole('button', { name: /^next$/i }).isDisabled();
    await shot(page, 'basics', 'STEP 2 basics, pristine — name/bio/tags', { nextDisabledEmpty, ...(await chrome(page)) });
    // refresh-safety probe: reload mid-step
    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'basics-after-refresh', 'refresh mid-step: still on basics?');
    // minimum path: name only (are bio/tags labeled optional?)
    await page.locator('#first_name').fill('Sam'); // TAP 7 + 3 keys
    await shot(page, 'basics-name-only', 'name only — bio + tags left empty (no "optional" hint?)');
    await page.getByRole('button', { name: /^next$/i }).click(); // TAP 8
    await page.waitForURL(/\/onboarding\/photo/, { timeout: 15_000 });

    // -- 5. STEP 3: photo --------------------------------------------------------
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'photo', 'STEP 3 photo, pristine', await chrome(page));
    // back-CHIP probe (today's fix): tap ← back, expect basics with Sam still saved.
    await page.locator('button[aria-label="back"]').first().click();
    await page.waitForURL(/\/onboarding\/basics/, { timeout: 10_000 }).catch(() => {});
    await shot(page, 'photo-backchip', 'tapped the ← back chip from photo — name retained?', {
      nameValue: await page.locator('#first_name').inputValue().catch(() => 'n/a'),
    });
    await page.goto('/onboarding/photo');
    await page.waitForLoadState('networkidle').catch(() => {});
    // browser back-button probe mid-wizard:
    await page.goBack();
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'photo-browser-back', 'browser BACK from photo: where did we land?');
    await page.goForward().catch(() => {});
    if (!page.url().includes('/onboarding/photo')) await page.goto('/onboarding/photo');
    await page.waitForLoadState('networkidle').catch(() => {});

    await page.locator('#photo').setInputFiles('public/gallery/bookshop-cozy.jpg'); // TAP 9 (+ picker)
    const looksGood = page.getByRole('button', { name: /looks good/i });
    await expect(looksGood).toBeVisible({ timeout: 15_000 });
    await shot(page, 'photo-cropper', 'cropper appears with zoom slider');
    // KNOWN dev-only wall: under `next dev` StrictMode the cropper's object URL is
    // revoked by the simulated double-mount (useMemo keeps the URL, the effect
    // cleanup revokes it) → blob: img 404s → "looks good" never enables. Probe,
    // diagnose, and degrade to the service-role hop instead of hanging.
    const cropperAlive = await expect(looksGood).toBeEnabled({ timeout: 15_000 }).then(() => true).catch(() => false);
    let photoOutcome = 'cropper-dead';
    if (cropperAlive) {
      await looksGood.click(); // TAP 10
      await shot(page, 'photo-ready', 'cropped preview, CTA armed');
      await page.getByRole('button', { name: /^next$/i }).click(); // TAP 11 — uploads + generate-blur
      photoOutcome = await Promise.race([
        page.waitForURL(/\/onboarding\/preferences/, { timeout: 45_000 }).then(() => 'advanced'),
        page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'error'),
      ]).catch(() => 'timeout');
    }
    const imgDiag = await page.locator('img[src^="blob:"]').first()
      .evaluate((i) => ({ src: (i as HTMLImageElement).src.slice(0, 40), naturalWidth: (i as HTMLImageElement).naturalWidth }))
      .catch(() => null);
    await shot(page, 'photo-submit-result', `photo outcome: ${photoOutcome}`, { photoOutcome, imgDiag });
    if (photoOutcome !== 'advanced') {
      // wall captured — service-role hop (mirror what the step writes) + continue
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const me = list?.users.find((x) => x.email === email)!;
      await sb.from('profiles').update({
        clear_photo_url: '/places/place-cafe.jpg', blurred_photo_url: '/places/place-cafe.jpg',
        onboarding_step: 'preferences',
      }).eq('id', me.id);
      await page.goto('/onboarding/preferences');
    }

    // -- 6. STEP 4: preferences --------------------------------------------------
    await page.waitForLoadState('networkidle').catch(() => {});
    const hardNosHelper = await page.getByText(/instant no for you/i).count(); // today's fix
    await shot(page, 'preferences', 'STEP 4 preferences, pristine — pre-selected defaults + hard-nos helper', {
      hardNosHelperPresent: hardNosHelper, ...(await chrome(page)),
      defaults: {
        gender: await page.getByRole('radio', { checked: true }).allInnerTexts().catch(() => []),
        ageFrom: await page.getByLabel(/age from/i).inputValue(),
        ageTo: await page.getByLabel(/age to/i).inputValue(),
      },
    });
    // today's-fix probe: the age input must type "19" (not "019") and delete cleanly.
    const ageFrom = page.getByLabel(/age from/i);
    await ageFrom.click();
    await ageFrom.press('ControlOrMeta+a');
    await ageFrom.press('Backspace');
    const ageEmptied = await ageFrom.inputValue();
    await ageFrom.pressSequentially('19');
    const ageTyped = await ageFrom.inputValue();
    await ageFrom.press('Backspace');
    await ageFrom.press('Backspace');
    const ageReEmptied = await ageFrom.inputValue();
    await ageFrom.pressSequentially('019'); // careless leading zero
    const ageLeadingZero = await ageFrom.inputValue();
    await shot(page, 'preferences-age-probe', 'age input after type/delete probe', {
      ageEmptied, ageTyped, ageReEmptied, ageLeadingZero,
    });
    // empty-age submit: friendly block expected
    await ageFrom.press('ControlOrMeta+a');
    await ageFrom.press('Backspace');
    await page.getByRole('button', { name: /^next$|try again/i }).click();
    await page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
    await shot(page, 'preferences-empty-age-submit', 'submitted with age-from empty — error copy');
    await ageFrom.pressSequentially('25');
    await page.getByRole('button', { name: /^next$|try again/i }).click(); // TAP — accept defaults
    await page.waitForURL(/\/onboarding\/phone/, { timeout: 15_000 });

    // -- 7. STEP 5: phone --------------------------------------------------------
    // Local [auth.sms.test_otp] maps 250 555 0199 → 123456, so the WHOLE step runs
    // for real (send → wrong code → use-a-different-number → resend → right code).
    // If the mapping isn't active the send fails: capture + service-role hop.
    await page.waitForLoadState('networkidle').catch(() => {});
    const textMeDisabledEmpty = await page.getByRole('button', { name: /text me a code/i }).isDisabled();
    await shot(page, 'phone', 'STEP 5 phone, pristine', { textMeDisabledEmpty, ...(await chrome(page)) });
    await page.locator('#phone').fill('123');
    await page.getByRole('button', { name: /text me a code/i }).click(); // TAP 13
    await page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await shot(page, 'phone-partial-number', 'partial number submitted — error copy');
    await page.locator('#phone').fill('250 555 0199');
    await page.getByRole('button', { name: /text me a code/i }).click(); // TAP 14
    await page.waitForTimeout(4000);
    let phoneStage = (await page.locator('#code').count()) > 0 ? 'code-entry' : 'send-failed';
    await shot(page, 'phone-send-result', `full number submitted → ${phoneStage}`, {
      phoneStage,
      resendThrottleVisible: await page.getByText(/resend in \d+s/i).count(),
      differentNumberVisible: await page.getByRole('button', { name: /use a different number/i }).count(),
    });
    let phoneVerifiedLive = false;
    if (phoneStage === 'code-entry') {
      // wrong code → error + escape-hatch state
      await page.locator('#code').fill('000000');
      await page.getByRole('button', { name: /i'm in/i }).click();
      await page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      await shot(page, 'phone-bad-code', 'wrong code — error + escape hatch state', {
        escapeHatchVisible: await page.getByText(/having trouble/i).count() > 0,
      });
      // "use a different number" (today's fix) → back to phone entry, editable again
      await page.getByRole('button', { name: /use a different number/i }).click();
      await shot(page, 'phone-different-number', 'tapped "use a different number" — phone editable again?', {
        phoneEditable: !(await page.locator('#phone').isDisabled()),
        phoneValueKept: await page.locator('#phone').inputValue(),
      });
      // resend path: send again, watch the throttle count down to "resend code"
      await page.waitForTimeout(5500); // respect GoTrue max_frequency=5s
      await page.getByRole('button', { name: /text me a code/i }).click();
      await page.locator('#code').waitFor({ state: 'visible', timeout: 10_000 });
      await shot(page, 'phone-resend-throttle', 'second send — resend throttle counting down');
      await page.getByRole('button', { name: /resend code/i }).waitFor({ state: 'visible', timeout: 40_000 });
      await page.getByRole('button', { name: /resend code/i }).click();
      await page.waitForTimeout(2000);
      await shot(page, 'phone-resent', 'tapped resend code — escape hatch should now show', {
        escapeHatchVisible: await page.getByText(/having trouble/i).count() > 0,
      });
      // the right code → real advance to verify
      await page.locator('#code').fill('123456');
      await page.getByRole('button', { name: /i'm in/i }).click();
      await page.waitForURL(/\/onboarding\/verify/, { timeout: 20_000 }).then(() => { phoneVerifiedLive = true; })
        .catch(async () => { await shot(page, 'phone-right-code-stuck', 'correct test OTP did NOT advance'); });
    }
    if (!phoneVerifiedLive) {
      // wall captured — service-role hop to selfie_verify (what confirmPhone+advance would do)
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const me = list?.users.find((x) => x.email === email)!;
      await sb.from('profiles').update({ onboarding_step: 'selfie_verify' }).eq('id', me.id);
      await page.goto('/onboarding/verify');
    }

    // -- 8. STEP 6: identity verify (the Persona cliff) ---------------------------
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'verify', 'STEP 6 verify pitch screen — how is the ID check sold?', await chrome(page));
    await page.getByRole('button', { name: /let's do it|starting/i }).click(); // TAP 15
    await page.waitForTimeout(6000);
    const personaUp = await page.locator('iframe').count() > 0;
    await shot(page, 'verify-start-result', `persona start outcome: ${personaUp ? 'embed loaded' : 'error/wall'}`, { personaUp });
    // wall captured (local has no Persona keys) — service-role the verdict the
    // webhook would write: birthdate (from the ID) + verified + done.
    {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const me = list?.users.find((x) => x.email === email)!;
      await sb.from('profiles_private').upsert({ user_id: me.id, birthdate: '1999-05-14' }, { onConflict: 'user_id' });
      await sb.from('profiles').update({ verification: 'verified', onboarding_step: 'done' }).eq('id', me.id);
    }

    // -- 9. STEP 7: done + the payoff (copy changed 2026-06-09: primary nav CTA is
    // now "see tonight's nights →" targeting /feed in BOTH gate states; "take me in"
    // is gone; a quiet "home" link is the secondary) -------------------------------
    await page.goto('/onboarding/done');
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'done', 'STEP 7 done, gate-ok branch — badge + turn-dating-on + outlined feed CTA', {
      ...(await chrome(page)),
      ctas: await page.locator('button, a').allInnerTexts().then((t) => t.filter(Boolean)),
    });
    // careless double-tap on "turn dating on":
    const turnOn = page.getByRole('button', { name: /turn dating on|turning on/i });
    await turnOn.click(); // TAP 16
    await turnOn.click({ timeout: 1200 }).catch(() => {});
    await expect(page.getByText(/dating's on/i)).toBeVisible({ timeout: 10_000 });
    await shot(page, 'done-dating-on', 'dating enabled — "see tonight\'s nights" should now be the pink primary');
    await page.getByRole('button', { name: /see tonight/i }).click(); // TAP 17 — straight to the payoff
    await page.waitForURL(/\/feed/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    const cardCount = await page.locator('text=/tap to read the full plan/i').count()
      + await page.getByLabel(/tap to read the full plan/i).count();
    await shot(page, 'feed-first-night', 'THE PAYOFF: first real night a new user sees', { cardCount });
    // and the post-onboarding home, for the record:
    await page.goto('/home');
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'home-first-session', 'post-onboarding /home (secondary destination)');
    await ctx.close();
  });

  // ============================================================================
  // WALK 2 — the other order (teaser-first): fresh signup → straight to /feed
  // pre-verification. Browse must be read-only; the heart must prompt verify.
  // Also: is /feed even DISCOVERABLE for a pre-verification user?
  // ============================================================================
  test('walk 2: teaser feed before verification', async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    watch(page, 'walk2');
    const email = `teaser+${runId}@e2e.local`;
    walkUserEmails.push(email);

    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill(email);
    await page.getByRole('button', { name: /email me a (sign-in )?link/i }).click();
    await expect(page.getByText(/sent a sign-in link/i)).toBeVisible();
    await page.goto(await findVerifyUrl(ctx, email));
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });

    // discoverability probe: from where the app puts the user, is there ANY
    // affordance to the teaser feed without typing a URL?
    await page.waitForLoadState('networkidle').catch(() => {});
    const feedLinks = await page.locator('a[href="/feed"]').count();
    await shot(page, 'teaser-entry-point', 'fresh user landing — any visible path to /feed?', { feedLinksVisible: feedLinks });

    await page.goto('/feed');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, 'teaser-feed', 'pre-verification /feed (teaser browse, shipped today)');

    // the heart: must prompt verify, not act
    const heart = page.getByRole('button', { name: /interested/i });
    if (await heart.count()) {
      await heart.first().click();
      await page.waitForTimeout(1200);
      await shot(page, 'teaser-heart-prompt', 'tapped the heart pre-verification — prompt?');
      const verifyAction = page.getByRole('button', { name: /verify me/i });
      if (await verifyAction.count()) {
        await verifyAction.first().click();
        await page.waitForTimeout(2000);
        await shot(page, 'teaser-verify-route', 'tapping "verify me" routes to…');
      }
      // pass (X) should keep browsing read-only
      await page.goto('/feed');
      await page.waitForLoadState('networkidle').catch(() => {});
      const pass = page.getByRole('button', { name: /pass on this one/i });
      if (await pass.count()) {
        await pass.first().click();
        await page.waitForTimeout(1000);
        await shot(page, 'teaser-pass-advances', 'pass (X) pre-verification — next card?');
      }
    } else {
      await shot(page, 'teaser-no-cards', 'NO action buttons / cards rendered in teaser mode');
    }
    await ctx.close();
  });

  // ============================================================================
  // WALK 3 — careless-user probes: URL step-skipping ahead of state, done-page
  // honesty for an incomplete profile.
  // ============================================================================
  test('walk 3: out-of-order + careless probes', async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    watch(page, 'walk3');
    const email = `careless+${runId}@e2e.local`;
    walkUserEmails.push(email);

    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill(email);
    await page.getByRole('button', { name: /email me a (sign-in )?link/i }).click();
    await expect(page.getByText(/sent a sign-in link/i)).toBeVisible();
    await page.goto(await findVerifyUrl(ctx, email));
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });

    // URL-skip every step while still at age_gate; record where each lands.
    const landed: Record<string, string> = {};
    for (const step of ['basics', 'photo', 'preferences', 'phone', 'verify', 'done']) {
      await page.goto(`/onboarding/${step}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      landed[step] = new URL(page.url()).pathname;
    }
    await shot(page, 'skip-to-done', 'URL-skipped to /onboarding/done at age_gate — honest?', { landedUrls: landed });

    // /onboarding index should route back to the true step.
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'onboarding-index-resume', '/onboarding routes the stalled user to…');
    await ctx.close();
  });

  // ============================================================================
  // WALK 4 — gate-blocked honesty (today's fixes): a user whose onboarding is
  // 'done' but who is NOT verified. The done step must branch to "almost there"
  // + the gate card (no "turn dating on"); /home must show the gate-notice card.
  // ============================================================================
  test('walk 4: gate-blocked done step + home gate notice', async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    watch(page, 'walk4');
    const sb = admin();
    const email = `gated+${runId}@e2e.local`;
    walkUserEmails.push(email);

    // Seed the state directly: step done, adult birthdate, verification pending.
    const { data: u, error: uErr } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (uErr || !u.user) throw new Error(`walk4 seed: ${uErr?.message}`);
    await sb.from('profiles_private').upsert({ user_id: u.user.id, birthdate: '1997-09-09' }, { onConflict: 'user_id' });
    await sb.from('profiles').update({ first_name: 'Jo', verification: 'pending', onboarding_step: 'done' }).eq('id', u.user.id);

    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill(email);
    await page.getByRole('button', { name: /email me a (sign-in )?link/i }).click();
    await expect(page.getByText(/sent a sign-in link/i)).toBeVisible();
    await page.goto(await findVerifyUrl(ctx, email));
    await page.waitForURL((u2) => !u2.pathname.startsWith('/login'), { timeout: 20_000 });

    await page.goto('/onboarding/done');
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'done-gate-blocked', 'done step, gate BLOCKED — honest branch? one pink CTA?', {
      turnDatingOnPresent: await page.getByRole('button', { name: /turn dating on/i }).count(),
      gateCard: await page.locator('[role="alert"]').allInnerTexts().catch(() => []),
      ctas: await page.locator('button, a').allInnerTexts().then((t) => t.filter(Boolean)),
    });

    // /home while verification is pending → the clock banner (state machine wins).
    await page.goto('/home');
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'home-pending-banner', '/home with verification pending — clock card');

    // The gate-notice card proper (today's fix) renders in dating_off state with a
    // failing gate: verified, but no readable birthdate (the real Persona edge case).
    await sb.from('profiles').update({ verification: 'verified' }).eq('id', u.user.id);
    await sb.from('profiles_private').update({ birthdate: null }).eq('user_id', u.user.id);
    await page.goto('/home');
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'home-gate-notice', '/home gate-blocked (birthdate_missing) — the gate-notice card (today\'s fix)');
    await ctx.close();
  });
});
