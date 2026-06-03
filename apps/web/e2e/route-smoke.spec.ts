import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

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
