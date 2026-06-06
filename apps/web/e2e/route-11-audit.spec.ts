// route-11-audit — Phase 11 (UX-01) scripted AUDIT-COLLECTOR. NOT a judgement suite:
// it authed-navigates the key routes @420px and COLLECTS raw evidence per route
// (final url + http status + redirect, screenshot, console errors, failed network
// responses >=400, a back-affordance probe for DEEP routes, page <title> + heading
// presence). It writes everything to .planning/phases/11-.../__audit__/ for the
// orchestrator to review — severity is the orchestrator's call, not this spec's.
//
// MUST run with CI=1 so Playwright spawns its own LOCAL-pointed dev server
// (reuseExistingServer:false). The spec lives under testDir (e2e/) and its filename
// matches the route-* testMatch pattern in playwright.config.ts.
//   CI=1 npx playwright test e2e/route-11-audit.spec.ts --config=playwright.config.ts --reporter=line
//
// Mirrors route-03/route-07 capture: 420px viewport, service-role JWT fallback, mkdirSync.
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedChatThread, type ChatSeedResult } from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  // Local Supabase demo service-role JWT fallback (same as 03/05/06/07 capture specs)
  // so the spec is self-sufficient on the forced-local stack without exporting env first.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const VIEWPORT = { width: 420, height: 900 };

// Evidence lands in the phase __audit__/ dir. process.cwd() is apps/web; walk to repo root.
const OUT_DIR = join(
  process.cwd(),
  '..',
  '..',
  '.planning',
  'phases',
  '11-page-by-page-ux-nav-audit-remediation',
  '__audit__',
);
mkdirSync(OUT_DIR, { recursive: true });

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Network failures we deliberately ignore (not page-health signals).
function isBenignNetwork(url: string, status: number): boolean {
  if (/\/favicon\.ico(\?|$)/.test(url)) return true;
  if (/\/apple-icon|\/icon\.svg|\/manifest\.webmanifest/.test(url)) return true;
  // Next dev HMR / RSC prefetch 404s on absent optional chunks are dev noise.
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
  skipped?: string; // reason, if the route could not be reached/seeded
}

// One navigation + capture. `deep` toggles the back-affordance probe.
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
    // networkidle can time out on streaming/polling routes; fall back to domcontentloaded.
    try {
      const resp = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      status = resp ? resp.status() : null;
    } catch {
      /* record whatever final url we ended on below */
    }
  }
  // Let client hydration + late console/network settle.
  await page.waitForTimeout(1500);

  const finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
  const requestedPath = new URL(route, 'http://localhost:3000').pathname;
  const redirected = new URL(page.url()).pathname !== requestedPath;

  // Back-affordance probe (DEEP routes only): the DeepRouteHeader renders a <Link>
  // with aria-label containing "back" and an ArrowLeft icon (components/DeepRouteHeader.tsx).
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

const findings: RouteFinding[] = [];

// Shared seed for the authed + deep routes (one promoted host + cand + an active offer +
// open chat thread; we promote it to a lock for /matches/[lockId]).
let seed: ChatSeedResult;
let lockId: string | null = null;
let placeSlug: string | null = null;

test.describe('11 route audit-collector @420px (forced-local)', () => {
  test.use({ viewport: VIEWPORT });

  test.beforeAll(async () => {
    if (!SUPABASE_URL.includes('127.0.0.1')) {
      throw new Error(`REFUSING to seed: SUPABASE_URL is not local (${SUPABASE_URL})`);
    }
    const sb = admin();

    // Deep ID-route fixtures: active offer + open thread + a promoted lock.
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

    // A real catalog place for /places/[slug].
    const { data: place } = await sb.from('places').select('slug').limit(1).single();
    placeSlug = (place?.slug as string) ?? null;
  });

  test('collect raw audit evidence across the key routes', async ({ browser }) => {
    // ---- PUBLIC routes (no auth) -----------------------------------------
    const pubCtx = await browser.newContext({ viewport: VIEWPORT });
    const pubPage = await pubCtx.newPage();
    for (const [route, slug] of [
      ['/', 'root'],
      ['/login', 'login'],
    ] as const) {
      findings.push(await captureRoute(pubPage, route, slug, false));
    }
    await pubCtx.close();

    // ---- AUTHED routes (candidate POV; promoted/verified so no /onboarding bounce) ----
    const candCtx = await browser.newContext({ viewport: VIEWPORT });
    const candPage = await loginAs(candCtx, seed.candEmail);

    const authedRoutes: [string, string][] = [
      ['/feed', 'feed'],
      ['/create', 'create'],
      ['/create/generate', 'create-generate'],
      ['/account', 'account'],
      ['/account/preferences', 'account-preferences'],
      ['/matches', 'matches'],
      ['/my-nights', 'my-nights'],
      ['/inbox', 'inbox'],
      ['/nights/new', 'nights-new'],
      ['/places', 'places'],
    ];
    for (const [route, slug] of authedRoutes) {
      findings.push(await captureRoute(candPage, route, slug, false));
    }

    // ---- DEEP / ID routes (candidate POV) --------------------------------
    // /places/[slug] — any seeded catalog place.
    if (placeSlug) {
      findings.push(await captureRoute(candPage, `/places/${placeSlug}`, 'places-slug', true));
    } else {
      findings.push(skip('/places/[slug]', 'places-slug', 'no seeded place found'));
    }

    // /matches/[lockId] — candidate is the matched_user → participant.
    if (lockId) {
      findings.push(await captureRoute(candPage, `/matches/${lockId}`, 'matches-lockid', true));
    } else {
      findings.push(skip('/matches/[lockId]', 'matches-lockid', 'lock seed failed'));
    }

    // /messages/[threadId] — candidate is a thread party.
    findings.push(
      await captureRoute(candPage, `/messages/${seed.threadId}`, 'messages-threadid', true),
    );

    // /offers/[offerId] — candidate is the offer recipient.
    findings.push(
      await captureRoute(candPage, `/offers/${seed.offerId}`, 'offers-offerid', true),
    );

    await candCtx.close();

    // /dates/[slug]/interested — HOST POV (the host owns the interested list).
    const hostCtx: BrowserContext = await browser.newContext({ viewport: VIEWPORT });
    const hostPage = await loginAs(hostCtx, seed.hostEmail);
    findings.push(
      await captureRoute(
        hostPage,
        `/dates/${seed.instanceId}/interested`,
        'dates-slug-interested',
        true,
      ),
    );
    await hostCtx.close();

    // ---- Write the raw findings JSON -------------------------------------
    writeFileSync(join(OUT_DIR, 'audit-raw.json'), JSON.stringify(findings, null, 2));

    // ---- Console summary for the run log ---------------------------------
    const totalConsole = findings.reduce((n, f) => n + f.consoleErrors.length, 0);
    const totalNet = findings.reduce((n, f) => n + f.networkFailures.length, 0);
    const missingBack = findings.filter((f) => f.hasBackAffordance === false).map((f) => f.route);
    console.log('\n==== AUDIT SUMMARY ====');
    console.log('routes captured     :', findings.filter((f) => !f.skipped).length);
    console.log('routes skipped      :', findings.filter((f) => f.skipped).length);
    console.log('total console errors:', totalConsole);
    console.log('total network >=400 :', totalNet);
    console.log('deep routes missing back-affordance:', missingBack.length ? missingBack.join(', ') : '(none)');
    console.log('seeded: offerId=%s threadId=%s lockId=%s placeSlug=%s instanceId=%s', seed.offerId, seed.threadId, lockId, placeSlug, seed.instanceId);
  });
});

function skip(route: string, _slug: string, reason: string): RouteFinding {
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
