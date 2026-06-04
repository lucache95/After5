import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import {
  seedTwoUsersAndNight,
  seedChatThread,
  cleanup,
  cleanupChat,
  type SeedResult,
  type ChatSeedResult,
} from './_helpers/seed';

// route-smoke — traverse the full reachable route list and assert each route
//   (1) loads (no HTTP 4xx/5xx on the document, no redirect to /login when authed),
//   (2) raises no uncaught React/runtime error in the console, and
//   (3) is on the NEW Barbiecore brand — never the LEGACY serif look.
//
// Route list + brand contract come from
//   docs/superpowers/reports/2026-06-02-brand-alignment-audit.md.
// LEGACY signals (audit §Detection): Fraunces serif (tailwind `font-display` utility →
//   var(--font-inter-display) → Fraunces) and a serif "after5" wordmark. The reliable,
//   low-false-positive check is the COMPUTED font-family on real text plus the literal
//   `font-display` Tailwind class in markup. (globals.css applies the heading font via an
//   `@apply` rule on h1/h2/h3, which inlines CSS properties — it does NOT add a class
//   attribute — so scanning class attributes for `font-display` flags only legacy JSX.)
//   Barbiecore pages render font-heading=Caprasimo / font-body=Fredoka, never Fraunces.

// ---------------------------------------------------------------------------
// Brand + health assertion shared by every route check.
// ---------------------------------------------------------------------------

// Console errors that are environmental noise, not page faults. The local E2E
// stack has no PWA service worker / analytics / image CDN, and next/image can
// log 4xx for un-allowlisted hosts; none of these are a route regression.
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /service worker/i,
  /manifest/i,
  /favicon/i,
  /Failed to load resource: the server responded with a status of 404/i, // missing static asset, not a page crash
];

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err: Error) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

interface BrandReport {
  fraunces: string[]; // sample texts of elements computing the Fraunces serif
  fontDisplayClass: number; // count of elements carrying the literal `font-display` class
  serifWordmark: boolean; // a serif-styled "after5" wordmark
}

// Runs IN the page. Walks visible text-bearing elements, flags any whose computed
// font-family contains "Fraunces" (the legacy serif), counts literal `font-display`
// classes, and detects a serif "after5" wordmark.
async function probeBrand(page: Page): Promise<BrandReport> {
  return page.evaluate(() => {
    const fraunces: string[] = [];
    let fontDisplayClass = 0;
    let serifWordmark = false;

    const all = Array.from(document.querySelectorAll<HTMLElement>('body *'));
    for (const el of all) {
      const cls = typeof el.className === 'string' ? el.className : '';
      // literal Tailwind `font-display` utility in markup (whole-word, not font-display-foo)
      if (/(^|\s)font-display(\s|$)/.test(cls)) fontDisplayClass += 1;

      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const ff = getComputedStyle(el).fontFamily;
      if (/fraunces/i.test(ff)) {
        if (fraunces.length < 8) fraunces.push(`${el.tagName.toLowerCase()}: "${text.slice(0, 40)}"`);
      }
      // serif "after5" wordmark = the brand name rendered in a serif family.
      if (/^after5$/i.test(text) && /(serif|fraunces|georgia|times)/i.test(ff) && !/fredoka|caprasimo|inter/i.test(ff)) {
        serifWordmark = true;
      }
    }
    return { fraunces, fontDisplayClass, serifWordmark };
  });
}

/**
 * Visit `path`, assert it loads cleanly and is on-brand.
 * @param expectLoginRedirect when true the route is unauth-gated and a bounce to /login is the
 *   correct behaviour (we then brand-check the login page we land on, which must itself be Barbiecore).
 */
async function checkRoute(
  page: Page,
  path: string,
  opts: { expectLoginRedirect?: boolean } = {},
): Promise<void> {
  const errors = watchConsole(page);
  const res = await page.goto(path, { waitUntil: 'networkidle' });

  // (1a) document HTTP status — Next serves 200 for matched routes, 404 for not-found.
  const status = res?.status() ?? 0;
  expect(status, `${path} → HTTP ${status}`).toBeLessThan(400);

  // (1b) not a Next runtime-error / not-found page
  const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
  expect(bodyText, `${path} shows a Next error overlay`).not.toMatch(
    /Application error: a (client|server)-side exception|This page could not be found|Unhandled Runtime Error/i,
  );

  // (1c) redirect expectation. `/login` is itself the login page, so landing there is
  // correct when the route is /login OR when the route is an auth-gated one we expect to bounce.
  const landed = new URL(page.url()).pathname;
  const requestedLogin = new URL(path, 'http://x').pathname.startsWith('/login');
  if (opts.expectLoginRedirect || requestedLogin) {
    expect(landed, `${path} should reach /login but landed on ${landed}`).toMatch(/^\/login/);
  } else {
    expect(landed, `${path} unexpectedly bounced to ${landed} (auth/session lost?)`).not.toMatch(/^\/login/);
  }

  // (2) no uncaught error in the console / no pageerror
  expect(errors, `${path} console errors:\n${errors.join('\n')}`).toEqual([]);

  // (3) on-brand
  const brand = await probeBrand(page);
  expect(brand.fraunces, `${path} renders the LEGACY Fraunces serif on:\n${brand.fraunces.join('\n')}`).toEqual([]);
  expect(brand.fontDisplayClass, `${path} carries ${brand.fontDisplayClass} literal legacy \`font-display\` class(es)`).toBe(0);
  expect(brand.serifWordmark, `${path} shows a legacy serif "after5" wordmark`).toBe(false);
}

// Assert the page exposes a working CTA into /create (the Barbiecore plan-a-night door).
async function assertCreateCta(page: Page, fromPath: string): Promise<void> {
  await page.goto(fromPath, { waitUntil: 'networkidle' });
  const cta = page.locator('a[href="/create"], a[href^="/create?"]').first();
  await expect(cta, `${fromPath} has no /create CTA`).toBeVisible();
  await cta.click();
  await page.waitForURL(/\/create(\?|$)/, { timeout: 15_000 });
  expect(new URL(page.url()).pathname, `${fromPath} CTA did not reach /create`).toBe('/create');
}

// ---------------------------------------------------------------------------
// ANON / PUBLIC routes — no session required.
// ---------------------------------------------------------------------------

const ANON_ROUTES = [
  '/',
  '/login',
  // rebranded catalog (audit: must be Barbiecore)
  '/places',
  '/types',
  '/vibes',
  '/neighborhoods',
  // create flow (anon-capable: gates premium, not the page)
  '/create',
  // marketing / auth
  '/join',
  '/about',
  '/roadmap',
  '/tell-us',
  '/unsubscribe',
] as const;

// Auth-gated routes that, when visited ANON, correctly redirect to /login.
// (/insiders is the Insider contributor dashboard — redirect('/login?next=/insiders').)
const ANON_GATED_ROUTES = ['/insiders'] as const;

test.describe('route-smoke · anon/public routes', () => {
  for (const path of ANON_ROUTES) {
    test(`${path} loads, no error, on-brand`, async ({ page }) => {
      await checkRoute(page, path);
    });
  }

  for (const path of ANON_GATED_ROUTES) {
    test(`${path} gates anon → /login`, async ({ page }) => {
      await checkRoute(page, path, { expectLoginRedirect: true });
    });
  }

  // KNOWN-LEGACY (audit §🔴): /dates loads + has a working /create CTA, but an inner
  // card heading still inherits the legacy Fraunces serif (Title Case "Coffee, dinner,
  // and a proper drink"). The page WRAPPER/header was rebranded; inner content was not.
  // Marked expected-to-fail so the suite stays green and flips RED once /dates is fully
  // Barbiecore. Remove `test.fail()` when the rebrand lands.
  test('/dates loads + on-brand [KNOWN LEGACY: inner heading serif]', async ({ page }) => {
    test.fail();
    await checkRoute(page, '/dates');
  });

  test('/ exposes a working CTA into /create', async ({ page }) => {
    await assertCreateCta(page, '/');
  });

  test('/dates exposes a working CTA into /create', async ({ page }) => {
    await assertCreateCta(page, '/dates');
  });
});

// ---------------------------------------------------------------------------
// AUTHED routes — log in once as a fully-onboarded, dating-enabled candidate.
// ---------------------------------------------------------------------------

const AUTHED_ROUTES = [
  '/home',
  '/feed',
  '/matches',
  '/messages',
  '/account',
  '/account/profile',
  '/account/notifications',
  '/my-nights',
  '/nights/new',
] as const;

// KNOWN-LEGACY authed routes (audit §🔴): load + are reachable, but still render the
// legacy brand (Fraunces serif, bg-background/border-border/text-text tokens, Title Case).
// Marked expected-to-fail; flips RED once rebranded. Remove from here when fixed.
const AUTHED_KNOWN_LEGACY = ['/account/saved'] as const;

test.describe('route-smoke · authed routes', () => {
  let seed: SeedResult;

  test.beforeAll(async () => {
    seed = await seedTwoUsersAndNight();
  });
  test.afterAll(async () => {
    if (seed) await cleanup(seed);
  });

  // One login, reused across the route list (faster + fewer Mailpit round-trips).
  test('authed route list loads, no error, on-brand', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await loginAs(context, seed.candEmail);
    try {
      for (const path of AUTHED_ROUTES) {
        await checkRoute(page, path);
      }
    } finally {
      await context.close();
    }
  });

  // Known-legacy authed routes: still render + reachable, but not yet rebranded.
  test('known-legacy authed routes load [KNOWN LEGACY: not yet rebranded]', async ({ browser }) => {
    test.fail();
    const context = await browser.newContext();
    const page = await loginAs(context, seed.candEmail);
    try {
      for (const path of AUTHED_KNOWN_LEGACY) {
        await checkRoute(page, path);
      }
    } finally {
      await context.close();
    }
  });

  // Onboarding routes: the seeded user is onboarding_step='done', so the guard
  // bounces these to the app (correct behaviour). We assert each renders without
  // error and on-brand, allowing the redirect target.
  test('onboarding routes load, no error, on-brand', async ({ browser }) => {
    const ONBOARDING = [
      '/onboarding',
      '/onboarding/welcome',
      '/onboarding/basics',
      '/onboarding/preferences',
      '/onboarding/photo',
      '/onboarding/phone',
      '/onboarding/verify',
      '/onboarding/done',
    ];
    const context = await browser.newContext();
    const page = await loginAs(context, seed.candEmail);
    const errors = watchConsole(page);
    try {
      for (const path of ONBOARDING) {
        const res = await page.goto(path, { waitUntil: 'networkidle' });
        expect(res?.status() ?? 0, `${path} → HTTP ${res?.status()}`).toBeLessThan(400);
        const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
        expect(bodyText, `${path} error overlay`).not.toMatch(
          /Application error|could not be found|Unhandled Runtime Error/i,
        );
        const brand = await probeBrand(page);
        expect(brand.fraunces, `${path} Fraunces serif:\n${brand.fraunces.join('\n')}`).toEqual([]);
        expect(brand.fontDisplayClass, `${path} legacy font-display class`).toBe(0);
      }
      expect(errors, `onboarding console errors:\n${errors.join('\n')}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// E1 / REQ-E1 — deep-route back chrome (DeepRouteHeader, D-07-nav / D-08).
// Every deep route AND every link-less guard/error terminal must expose a
// DETERMINISTIC back affordance: a real <a href> (static <Link>), NOT a
// history.back()-style JS-only button (a cold-entered deep route has an empty
// history stack, so a blind pop would exit the app). We assert, on each route:
//   (1) a back control with the DeepRouteHeader aria-label ('back to …') exists,
//   (2) it is an <A> element carrying an href (static Link, not a button),
//   (3) the href resolves to its documented parent route,
//   (4) it is keyboard/clickable (visible) — no link-less dead-end remains.
// Reuses the existing PKCE auth + seedChatThread fixtures; introduces no new
// auth recipe and stays within the existing Playwright config.
// ---------------------------------------------------------------------------

// Assert the deep route at `path` exposes a DeepRouteHeader back control that is
// a static <a href> resolving to `expectedParent`, and that no JS-only
// history-back control stands in for it.
async function assertDeepRouteBackAffordance(
  page: Page,
  path: string,
  opts: { backLabel: string; expectedParent: string },
): Promise<void> {
  const errors = watchConsole(page);
  const res = await page.goto(path, { waitUntil: 'networkidle' });

  // The route must render (party happy-path) OR render its guard <main> (non-party);
  // either way it is a matched route, never a 4xx document or a /login bounce.
  const status = res?.status() ?? 0;
  expect(status, `${path} → HTTP ${status}`).toBeLessThan(400);
  const landed = new URL(page.url()).pathname;
  expect(landed, `${path} unexpectedly bounced to ${landed} (auth/session lost?)`).not.toMatch(/^\/login/);

  // (1) the back control exists, labelled by DeepRouteHeader's aria-label.
  const back = page.getByRole('link', { name: opts.backLabel });
  await expect(back, `${path} has no '${opts.backLabel}' back affordance (link-less terminal?)`).toBeVisible();

  // (2) it is a real anchor (static Link), NOT a JS-only button.
  const tag = await back.evaluate((el) => el.tagName.toLowerCase());
  expect(tag, `${path} back control is <${tag}>, expected a static <a> (D-08, no history.back())`).toBe('a');

  // (3) the href resolves to the documented parent route.
  const href = await back.getAttribute('href');
  expect(href, `${path} back href is "${href}", expected "${opts.expectedParent}"`).toBe(opts.expectedParent);

  // (4) clicking it actually navigates to the parent (deterministic, no app-exit).
  await back.click();
  await page.waitForURL((url) => url.pathname === opts.expectedParent, { timeout: 15_000 });
  expect(new URL(page.url()).pathname, `${path} back did not reach ${opts.expectedParent}`).toBe(opts.expectedParent);

  expect(errors, `${path} console errors:\n${errors.join('\n')}`).toEqual([]);
}

test.describe('route-smoke · E1 deep-route back chrome (REQ-E1)', () => {
  let seed: ChatSeedResult;

  test.beforeAll(async () => {
    // offerId + threadId (candidate is a party) + instanceId (host is creator) +
    // an outsider (non-party) to trigger the "not your offer" guard terminal.
    seed = await seedChatThread();
  });
  test.afterAll(async () => {
    if (seed) await cleanupChat(seed);
  });

  test('every deep route (party happy-path) exposes a static back link to its parent', async ({ browser }) => {
    // Candidate is the offer recipient + a chat party → offers/messages/inbox render.
    const candContext = await browser.newContext();
    const candPage = await loginAs(candContext, seed.candEmail);
    try {
      await assertDeepRouteBackAffordance(candPage, `/offers/${seed.offerId}`, {
        backLabel: 'back to inbox',
        expectedParent: '/inbox',
      });
      await assertDeepRouteBackAffordance(candPage, `/messages/${seed.threadId}`, {
        backLabel: 'back to inbox',
        expectedParent: '/inbox',
      });
      // The /inbox/[threadId] re-export must inherit the SAME header (not forked).
      await assertDeepRouteBackAffordance(candPage, `/inbox/${seed.threadId}`, {
        backLabel: 'back to inbox',
        expectedParent: '/inbox',
      });
    } finally {
      await candContext.close();
    }

    // Host is the night's creator → the interested list renders.
    const hostContext = await browser.newContext();
    const hostPage = await loginAs(hostContext, seed.hostEmail);
    try {
      await assertDeepRouteBackAffordance(hostPage, `/dates/${seed.instanceId}/interested`, {
        backLabel: 'back to your nights',
        expectedParent: '/my-nights',
      });
    } finally {
      await hostContext.close();
    }
  });

  test('the deep-route GUARD terminal ("not your offer") also exposes the back link', async ({ browser }) => {
    // The outsider is NOT a party to this offer → the "not your offer" guard <main>
    // renders. Before E1 this was a link-less dead-end (audit C-class); now it must
    // carry the same DeepRouteHeader back affordance so the user is never trapped.
    const context = await browser.newContext();
    const page = await loginAs(context, seed.outsiderEmail);
    try {
      await page.goto(`/offers/${seed.offerId}`, { waitUntil: 'networkidle' });
      // confirm we are on the guard terminal, not the happy path.
      await expect(page.getByText(/not your offer/i)).toBeVisible();
      await assertDeepRouteBackAffordance(page, `/offers/${seed.offerId}`, {
        backLabel: 'back to inbox',
        expectedParent: '/inbox',
      });
    } finally {
      await context.close();
    }
  });

  test('the account/notifications deep route exposes a static back link to /account', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await loginAs(context, seed.candEmail);
    try {
      await assertDeepRouteBackAffordance(page, '/account/notifications', {
        backLabel: 'back to your account',
        expectedParent: '/account',
      });
    } finally {
      await context.close();
    }
  });
});
