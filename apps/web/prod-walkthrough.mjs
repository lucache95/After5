// Prod walkthrough — drives tryafter5.app with Playwright, captures full-page
// mobile screenshots + per-page console/page errors for a logged-out pass and an
// authed (cohort r2host) pass. Authed login uses an admin-generated magiclink
// token_hash through /auth/confirm (sets SSR cookies; no Mailpit needed).
// READ-ONLY: navigates and screenshots only — no swipes/offers/mutations.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function envFrom(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

const env = { ...envFrom(join(ROOT,'apps/web/.env')), ...envFrom(join(ROOT,'apps/web/.env.local')) };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
const PROD = 'https://tryafter5.app';
const COHORT_EMAIL = 'lucache95+r2host@gmail.com';
const OUT = `${ROOT}/docs/superpowers/reports/prod-walkthrough-${new Date().toISOString().slice(0, 10)}`;
mkdirSync(OUT, { recursive: true });

const results = [];

async function adminMagicTokenHash(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email, redirect_to: PROD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`generate_link ${res.status}: ${JSON.stringify(body)}`);
  const hashed = body.hashed_token ?? body.properties?.hashed_token;
  if (!hashed) throw new Error(`no hashed_token in response: ${JSON.stringify(body).slice(0, 300)}`);
  return hashed;
}

async function visit(context, label, path) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${String(e).slice(0, 200)}`));
  let status = null, finalUrl = null, err = null;
  try {
    const resp = await page.goto(`${PROD}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(1200); // let client render/animate settle
    finalUrl = page.url();
  } catch (e) {
    err = String(e).slice(0, 200);
    finalUrl = page.url();
  }
  const file = join(OUT, `${label}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { err = (err ?? '') + ` [screenshot: ${e}]`; }
  results.push({ label, path, status, finalUrl, redirected: finalUrl !== `${PROD}${path}`, consoleErrors, err, file });
  console.log(`${status ?? 'ERR'}  ${label.padEnd(22)} ${path}  -> ${finalUrl}${consoleErrors.length ? `  (${consoleErrors.length} console err)` : ''}`);
  await page.close();
}

const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// ---- Logged-out pass ----
console.log('\n=== LOGGED-OUT ===');
const anon = await browser.newContext(ctxOpts);
for (const [label, path] of [
  ['anon-landing', '/'],
  ['anon-how-it-works', '/how-it-works'],
  ['anon-login', '/login'],
  ['anon-plan', '/plan'],
  ['anon-places', '/places'],
  ['anon-feed-redirect', '/feed'],
]) await visit(anon, label, path);
await anon.close();

// ---- Authed pass (cohort r2host, read-only) ----
console.log('\n=== AUTHED (r2host) ===');
let authedOk = false;
const authed = await browser.newContext(ctxOpts);
try {
  const hashed = await adminMagicTokenHash(COHORT_EMAIL);
  const p = await authed.newPage();
  await p.goto(`${PROD}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=magiclink&next=/home`, { waitUntil: 'networkidle', timeout: 30_000 });
  await p.waitForTimeout(1000);
  authedOk = !p.url().includes('/login');
  console.log(`login -> ${p.url()}  (authed=${authedOk})`);
  await p.close();
} catch (e) {
  console.log(`LOGIN FAILED: ${e}`);
}
if (authedOk) {
  for (const [label, path] of [
    ['auth-home', '/home'],
    ['auth-feed', '/feed'],
    ['auth-my-nights', '/my-nights'],
    ['auth-matches', '/matches'],
    ['auth-account', '/account'],
  ]) await visit(authed, label, path);
}
await authed.close();
await browser.close();

import('node:fs').then(({ writeFileSync }) =>
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ authedOk, results }, null, 2)));
console.log(`\nDone. authed=${authedOk}. Artifacts in ${OUT}`);
