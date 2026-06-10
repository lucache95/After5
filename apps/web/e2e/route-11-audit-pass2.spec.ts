// route-11-audit-pass2 — Phase 11 (UX-01) scripted AUDIT-COLLECTOR, PASS 2. NOT a
// judgement suite: covers the ~42 routes pass 1 (route-11-audit.spec.ts) did NOT —
// public/marketing/legacy-planner pages, catalog deep routes, authed account subpages,
// the onboarding funnel (fresh user), authed deep ID routes (inbox thread, rate,
// reciprocal, vote, feedback, plans edit), and the admin section. Same evidence shape
// as pass 1 (final url + status + redirect + screenshot + console errors + network
// >=400 + back-affordance probe for DEEP routes + title/heading), written to
// .planning/phases/11-.../__audit__/pass2/.
//
// MUST run with CI=1 so Playwright spawns its own LOCAL-pointed dev server. Export
// SERVICE_ROLE_KEY (from `supabase status -o env`) so the spawned Next server gets
// SUPABASE_SECRET_KEY (fixes the pass-1 /api/stats 500 artifact), plus:
//   ADMIN_EMAILS=audit-admin@e2e.local        (admin gate is an env allowlist)
//   SUBSCRIBER_TOKEN_SECRET=e2e-audit-secret  (feedback-token HMAC, shared w/ server)
//   CI=1 npx playwright test e2e/route-11-audit-pass2.spec.ts --config=playwright.config.ts --reporter=line
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { test, type Page, type Response } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedChatThread, type ChatSeedResult } from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  // Local Supabase demo service-role JWT fallback (same as pass 1).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Feedback links are HMAC-signed with SUBSCRIBER_TOKEN_SECRET. The runner exports the
// same value into the webServer env so spec-side signing matches server-side verify.
const FEEDBACK_SECRET = process.env.SUBSCRIBER_TOKEN_SECRET ?? 'e2e-audit-secret';

// Admin gate (lib/auth/require-admin.ts) is the ADMIN_EMAILS env allowlist — the
// runner exports this exact address so the seeded admin user passes the gate.
const ADMIN_EMAIL = 'audit-admin@e2e.local';

const VIEWPORT = { width: 420, height: 900 };

const OUT_DIR = join(
  process.cwd(),
  '..',
  '..',
  '.planning',
  'phases',
  '11-page-by-page-ux-nav-audit-remediation',
  '__audit__',
  'pass2',
);
mkdirSync(OUT_DIR, { recursive: true });

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Mirror lib/email/feedback-token.ts makeFeedbackToken (b64url(payload).b64url(hmac)).
function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeFeedbackToken(savedPlanId: string, itineraryId: string, email: string): string {
  const json = JSON.stringify({
    sp: savedPlanId,
    it: itineraryId,
    e: email.toLowerCase().trim(),
    iat: Math.floor(Date.now() / 1000),
  });
  const sig = createHmac('sha256', FEEDBACK_SECRET).update(json).digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

// Network failures we deliberately ignore (not page-health signals). Same as pass 1.
function isBenignNetwork(url: string, status: number): boolean {
  if (/\/favicon\.ico(\?|$)/.test(url)) return true;
  if (/\/apple-icon|\/icon\.svg|\/manifest\.webmanifest/.test(url)) return true;
  if (status === 404 && /\/_next\/(static|webpack-hmr)/.test(url)) return true;
  return false;
}

interface RouteFinding {
  route: string;
  finalUrl: string;
  status: number | null;
  redirected: boolean;
  consoleErrors: string[];
  networkFailures: { url: string; status: number }[];
  hasBackAffordance: boolean | null; // null = not a DEEP route (not probed)
  title: string | null;
  hasHeading: boolean;
  skipped?: string;
}

// One navigation + capture. `deep` toggles the back-affordance probe. Same as pass 1.
async function captureRoute(
  page: Page,
  route: string,
  slug: string,
  deep: boolean,
): Promise<RouteFinding> {
  const consoleErrors: string[] = [];
  const networkFailures: { url: string; status: number }[] = [];

  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  };
  const onResponse = (r: Response) => {
    const status = r.status();
    const url = r.url();
    if (status >= 400 && !isBenignNetwork(url, status)) {
      networkFailures.push({ url, status });
    }
  };
  page.on('console', onConsole);
  page.on('response', onResponse);

  let status: number | null = null;
  try {
    const resp = await page.goto(route, { waitUntil: 'networkidle', timeout: 30_000 });
    status = resp ? resp.status() : null;
  } catch {
    try {
      const resp = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      status = resp ? resp.status() : null;
    } catch {
      /* record whatever final url we ended on below */
    }
  }
  await page.waitForTimeout(1500);

  const finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
  const requestedPath = new URL(route, 'http://localhost:3000').pathname;
  const redirected = new URL(page.url()).pathname !== requestedPath;

  let hasBackAffordance: boolean | null = null;
  if (deep) {
    hasBackAffordance = await page
      .getByRole('link', { name: /back/i })
      .first()
      .count()
      .then((c) => c > 0)
      .catch(() => false);
  }

  const title = await page.title().catch(() => null);
  const hasHeading = await page
    .locator('h1, [role="heading"][aria-level="1"]')
    .first()
    .count()
    .then((c) => c > 0)
    .catch(() => false);

  await page.screenshot({ path: join(OUT_DIR, `${slug}.png`), fullPage: true }).catch(() => {});

  page.off('console', onConsole);
  page.off('response', onResponse);

  return {
    route,
    finalUrl,
    status,
    redirected,
    consoleErrors,
    networkFailures,
    hasBackAffordance,
    title: title || null,
    hasHeading,
  };
}

function skip(route: string, reason: string): RouteFinding {
  return {
    route,
    finalUrl: '',
    status: null,
    redirected: false,
    consoleErrors: [],
    networkFailures: [],
    hasBackAffordance: null,
    title: null,
    hasHeading: false,
    skipped: reason,
  };
}

// Keyed map so a CI retry of one test overwrites its own slugs instead of duplicating.
const findings = new Map<string, RouteFinding>();
function record(slug: string, f: RouteFinding) {
  findings.set(slug, f);
}

// Create-or-find an auth user by email (fixed-email users survive reruns).
async function ensureUser(sb: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (data?.user) return data.user.id;
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list?.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`ensureUser ${email}: ${error?.message}`);
  return u.id;
}

// ---- shared seed state -----------------------------------------------------
let seed: ChatSeedResult;
let lockId: string | null = null;
let itineraryId: string | null = null; // host itinerary (plans edit + admin dates + vote + feedback)
let publicDateSlug: string | null = null; // /dates/[slug]
let pairId: string | null = null; // /reciprocal/[pairId]
let voteId: string | null = null; // /vote/[id]
let feedbackToken: string | null = null; // /feedback/[token]
let freshEmail: string; // onboarding-funnel user (no profile promotion)

test.describe('11 route audit-collector PASS 2 @420px (forced-local)', () => {
  test.use({ viewport: VIEWPORT });

  test.beforeAll(async () => {
    if (!SUPABASE_URL.includes('127.0.0.1')) {
      throw new Error(`REFUSING to seed: SUPABASE_URL is not local (${SUPABASE_URL})`);
    }
    const sb = admin();
    const runId = Date.now().toString(36);

    // Base: host + cand + active offer + open thread (same as pass 1), promoted lock.
    seed = await seedChatThread();
    await sb.from('date_instances').update({ status: 'matched' }).eq('id', seed.instanceId);
    const { data: lock } = await sb
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
    lockId = (lock?.id as string) ?? null;
    if (lockId) await sb.from('chat_threads').update({ lock_id: lockId }).eq('id', seed.threadId);

    // Host itinerary id (FK parent of the seeded instance).
    const { data: itin } = await sb
      .from('itineraries')
      .select('id')
      .eq('user_id', seed.hostId)
      .limit(1)
      .single();
    itineraryId = (itin?.id as string) ?? null;

    // /dates/[slug] needs a PUBLIC itinerary with a slug — local DB has none; make
    // the seeded one public under a run-scoped slug.
    if (itineraryId) {
      publicDateSlug = `e2e-audit-night-${runId}`;
      const { error } = await sb
        .from('itineraries')
        .update({ slug: publicDateSlug, is_public: true })
        .eq('id', itineraryId);
      if (error) publicDateSlug = null;
    }

    // /reciprocal/[pairId]: needs TWO active offers between the pair on two distinct
    // instances. host→cand exists (seedChatThread); add a cand-owned night + the
    // reverse offer, then the pair row (low/high = uuid-sorted).
    if (itineraryId) {
      const { data: city } = await sb.from('cities').select('id').eq('slug', 'kelowna').single();
      const { data: candItin } = await sb
        .from('itineraries')
        .insert({
          user_id: seed.candId,
          inputs: { e2e: true, audit: 'pass2' },
          stops: [{
            place_name: 'Bean Scene Cafe', place_type: 'cafe', start_time: '19:30',
            duration_min: 60, estimated_cost_pp: 12, what_to_do: 'espresso + people-watch',
            neighborhood: 'Downtown', lat: 49.8852, lng: -119.4951,
          }],
          title: `E2E audit reverse night ${runId}`,
          hook: 'a counter-offer',
          why_it_works: 'short, sweet, walkable',
          total_cost_pp: 24,
          total_duration_min: 60,
          pay_setting: 'split',
          city_id: city?.id,
          is_public: false,
          vibe_tags: ['cozy'],
        })
        .select('id')
        .single();
      if (candItin) {
        const { data: candInst } = await sb
          .from('date_instances')
          .insert({
            itinerary_id: candItin.id,
            creator_id: seed.candId,
            city_id: city?.id,
            starts_at: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
            duration_min: 90,
            status: 'seeking',
          })
          .select('id')
          .single();
        if (candInst) {
          await sb.from('offers').insert({
            date_instance_id: candInst.id,
            creator_id: seed.candId,
            candidate_id: seed.hostId,
            status: 'active',
            expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          });
          const [lo, hi] = [seed.hostId, seed.candId].sort();
          const { data: pair } = await sb
            .from('reciprocal_pairs')
            .upsert({ low_user: lo, high_user: hi, status: 'open' }, { onConflict: 'low_user,high_user' })
            .select('id')
            .single();
          pairId = (pair?.id as string) ?? null;
        }
      }
    }

    // /vote/[id]: vote_sessions row over the host itinerary (public-read RLS).
    if (itineraryId) {
      const { data: vs } = await sb
        .from('vote_sessions')
        .insert({ itinerary_ids: [itineraryId], created_by_email: seed.hostEmail })
        .select('id')
        .single();
      voteId = (vs?.id as string) ?? null;
    }

    // /feedback/[token]: saved_plans row + HMAC token (secret shared with the server
    // via the exported SUBSCRIBER_TOKEN_SECRET).
    if (itineraryId) {
      const { data: sp } = await sb
        .from('saved_plans')
        .insert({ user_id: seed.candId, itinerary_id: itineraryId })
        .select('id')
        .single();
      if (sp) feedbackToken = makeFeedbackToken(sp.id as string, itineraryId, seed.candEmail);
    }

    // Admin user (ADMIN_EMAILS allowlist) + fresh onboarding user (NOT promoted, so
    // the funnel renders/redirects as for a real new signup).
    await ensureUser(sb, ADMIN_EMAIL);
    freshEmail = `fresh+${runId}@e2e.local`;
    await ensureUser(sb, freshEmail);
  });

  test.afterAll(async () => {
    const all = [...findings.values()];
    writeFileSync(join(OUT_DIR, 'audit-raw-pass2.json'), JSON.stringify(all, null, 2));
    const totalConsole = all.reduce((n, f) => n + f.consoleErrors.length, 0);
    const totalNet = all.reduce((n, f) => n + f.networkFailures.length, 0);
    const missingBack = all.filter((f) => f.hasBackAffordance === false).map((f) => f.route);
    console.log('\n==== PASS-2 AUDIT SUMMARY ====');
    console.log('routes captured     :', all.filter((f) => !f.skipped).length);
    console.log('routes skipped      :', all.filter((f) => f.skipped).length);
    console.log('total console errors:', totalConsole);
    console.log('total network >=400 :', totalNet);
    console.log('deep routes missing back-affordance:', missingBack.length ? missingBack.join(', ') : '(none)');
  });

  // ---- 1. PUBLIC / marketing / legacy-planner / catalog --------------------
  test('public + catalog routes', async ({ browser }) => {
    test.setTimeout(420_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();

    const publicRoutes: [string, string][] = [
      ['/about', 'about'],
      ['/home', 'home'],
      ['/join', 'join'],
      ['/insiders', 'insiders'],
      ['/roadmap', 'roadmap'],
      ['/tell-us', 'tell-us'],
      ['/privacy', 'privacy'],
      ['/terms', 'terms'],
      ['/offline', 'offline'],
      ['/dates', 'dates'],
      ['/types', 'types'],
      ['/vibes', 'vibes'],
      ['/neighborhoods', 'neighborhoods'],
    ];
    for (const [route, slug] of publicRoutes) {
      record(slug, await captureRoute(page, route, slug, false));
    }

    // Catalog deep routes — taxonomy slugs are static (lib/taxonomy.ts); the date
    // slug is the run-seeded public itinerary.
    if (publicDateSlug) {
      record('dates-slug', await captureRoute(page, `/dates/${publicDateSlug}`, 'dates-slug', true));
    } else {
      record('dates-slug', skip('/dates/[slug]', 'no public itinerary slug could be seeded'));
    }
    record('types-slug', await captureRoute(page, '/types/restaurant', 'types-slug', true));
    record('vibes-vibe', await captureRoute(page, '/vibes/romantic', 'vibes-vibe', true));
    record(
      'neighborhoods-slug',
      await captureRoute(page, '/neighborhoods/downtown', 'neighborhoods-slug', true),
    );

    // Tokenized/share public routes.
    if (voteId) {
      record('vote-id', await captureRoute(page, `/vote/${voteId}`, 'vote-id', false));
    } else {
      record('vote-id', skip('/vote/[id]', 'vote_sessions seed failed'));
    }
    if (feedbackToken) {
      record(
        'feedback-token',
        await captureRoute(page, `/feedback/${encodeURIComponent(feedbackToken)}`, 'feedback-token', false),
      );
    } else {
      record('feedback-token', skip('/feedback/[token]', 'saved_plans seed failed'));
    }

    await ctx.close();
  });

  // ---- 2. AUTHED account subpages (promoted candidate POV) -----------------
  test('authed account routes', async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await loginAs(ctx, seed.candEmail);
    for (const [route, slug] of [
      ['/account/notifications', 'account-notifications'],
      ['/account/profile', 'account-profile'],
      ['/account/saved', 'account-saved'],
      ['/messages', 'messages'],
    ] as const) {
      record(slug, await captureRoute(page, route, slug, false));
    }
    await ctx.close();
  });

  // ---- 3. ONBOARDING funnel (fresh, un-promoted user) -----------------------
  // A redirect (step guard) is EVIDENCE — captureRoute records the landed URL.
  test('onboarding funnel routes', async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await loginAs(ctx, freshEmail);
    for (const [route, slug] of [
      ['/onboarding', 'onboarding'],
      ['/onboarding/welcome', 'onboarding-welcome'],
      ['/onboarding/basics', 'onboarding-basics'],
      ['/onboarding/phone', 'onboarding-phone'],
      ['/onboarding/photo', 'onboarding-photo'],
      ['/onboarding/preferences', 'onboarding-preferences'],
      ['/onboarding/verify', 'onboarding-verify'],
      ['/onboarding/done', 'onboarding-done'],
    ] as const) {
      record(slug, await captureRoute(page, route, slug, false));
    }
    await ctx.close();
  });

  // ---- 4. AUTHED deep ID routes ---------------------------------------------
  test('authed deep routes', async ({ browser }) => {
    test.setTimeout(300_000);
    const sb = admin();

    // Candidate POV: inbox thread + reciprocal chooser.
    const candCtx = await browser.newContext({ viewport: VIEWPORT });
    const candPage = await loginAs(candCtx, seed.candEmail);
    record(
      'inbox-threadid',
      await captureRoute(candPage, `/inbox/${seed.threadId}`, 'inbox-threadid', true),
    );
    if (pairId) {
      record(
        'reciprocal-pairid',
        await captureRoute(candPage, `/reciprocal/${pairId}`, 'reciprocal-pairid', true),
      );
    } else {
      record('reciprocal-pairid', skip('/reciprocal/[pairId]', 'reciprocal pair seed failed'));
    }

    // Rate page HARD-gates on the rating window (date end + 2h). Move the seeded
    // instance into the past so the form (not the "not yet" gate) renders.
    if (lockId) {
      await sb
        .from('date_instances')
        .update({ starts_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), duration_min: 60 })
        .eq('id', seed.instanceId);
      record(
        'matches-lockid-rate',
        await captureRoute(candPage, `/matches/${lockId}/rate`, 'matches-lockid-rate', true),
      );
    } else {
      record('matches-lockid-rate', skip('/matches/[lockId]/rate', 'lock seed failed'));
    }
    await candCtx.close();

    // Host POV: the customization canvas (host owns the itinerary).
    const hostCtx = await browser.newContext({ viewport: VIEWPORT });
    const hostPage = await loginAs(hostCtx, seed.hostEmail);
    if (itineraryId) {
      record(
        'plans-id-edit',
        await captureRoute(hostPage, `/plans/${itineraryId}/edit`, 'plans-id-edit', true),
      );
    } else {
      record('plans-id-edit', skip('/plans/[id]/edit', 'host itinerary not found'));
    }
    await hostCtx.close();
  });

  // ---- 5. ADMIN section (ADMIN_EMAILS allowlist user) -----------------------
  test('admin routes', async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await loginAs(ctx, ADMIN_EMAIL);
    for (const [route, slug] of [
      ['/admin/alerts', 'admin-alerts'],
      ['/admin/eval', 'admin-eval'],
      ['/admin/feedback', 'admin-feedback'],
      ['/admin/insiders', 'admin-insiders'],
      ['/admin/reports', 'admin-reports'],
      ['/admin/venues', 'admin-venues'],
    ] as const) {
      record(slug, await captureRoute(page, route, slug, false));
    }
    if (itineraryId) {
      record(
        'admin-dates-id',
        await captureRoute(page, `/admin/dates/${itineraryId}`, 'admin-dates-id', true),
      );
    } else {
      record('admin-dates-id', skip('/admin/dates/[id]', 'no seeded itinerary id'));
    }
    await ctx.close();
  });
});
