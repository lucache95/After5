// Prod walkthrough EXTRA — covers the 3 authed surfaces the first pass missed:
//   1. Host interested list   /dates/<instanceId>/interested  (as r2host)
//   2. Offer detail           /offers/<offerId>               (as recipient r2cand)
//   3. Rate flow              /matches/<lockId>/rate           (as lock participant)
// Modeled on prod-walkthrough.mjs: same env-loading, adminMagicTokenHash() +
// /auth/confirm login, visit() helper, mobile viewport.
// STRICTLY READ-ONLY: navigate + screenshot only. No swipe/offer/accept/pass/rate
// or any mutation. The only side effect is creating an auth session (magic link).
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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

// Secrets live in apps/web/.env.local. In a git worktree that file isn't checked
// out, so fall back to the primary checkout's copy via APP_ENV_DIR or a default.
const ENV_DIR = process.env.APP_ENV_DIR ?? join(ROOT, 'apps/web');
const env = {
  ...envFrom(join(ROOT, 'apps/web/.env')),
  ...envFrom(join(ROOT, 'apps/web/.env.local')),
  ...envFrom(join(ENV_DIR, '.env')),
  ...envFrom(join(ENV_DIR, '.env.local')),
};
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
const PROD = 'https://tryafter5.app';

// Prod IDs resolved via read-only MCP SQL (prod ref ufufmcpnysvwtutpbian):
const HOST_EMAIL = 'lucache95+r2host@gmail.com';
const CAND_EMAIL = 'lucache95+r2cand@gmail.com';
const INSTANCE_ID = 'ae89bfeb-3132-4e5d-9bfd-7feaa65d12db'; // date_instances.creator_id = r2host, status=matched
const OFFER_ID = 'a2fca2d6-f671-44d0-bb26-e0bedb7431c4';    // offers, candidate=r2cand, status=accepted
const LOCK_ID = '823aa47a-c5f8-4abe-a75a-59e874ed5627';     // locks, creator=r2host, matched_user=r2cand

const OUT = `${ROOT}/docs/superpowers/reports/prod-walkthrough-extra-${new Date().toISOString().slice(0, 10)}`;
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
  let status = null, finalUrl = null, err = null, bodyText = null;
  try {
    const resp = await page.goto(`${PROD}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(1200); // let client render/animate settle
    finalUrl = page.url();
    bodyText = (await page.locator('body').innerText().catch(() => '') ?? '').slice(0, 600);
  } catch (e) {
    err = String(e).slice(0, 200);
    finalUrl = page.url();
  }
  const file = join(OUT, `${label}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { err = (err ?? '') + ` [screenshot: ${e}]`; }
  results.push({ label, path, status, finalUrl, redirected: finalUrl !== `${PROD}${path}`, consoleErrors, err, bodyText, file });
  console.log(`${status ?? 'ERR'}  ${label.padEnd(24)} ${path}  -> ${finalUrl}${consoleErrors.length ? `  (${consoleErrors.length} console err)` : ''}`);
  await page.close();
}

async function login(context, email, label) {
  let ok = false, url = null, err = null;
  try {
    const hashed = await adminMagicTokenHash(email);
    const p = await context.newPage();
    await p.goto(`${PROD}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=magiclink&next=/home`, { waitUntil: 'networkidle', timeout: 30_000 });
    await p.waitForTimeout(1000);
    url = p.url();
    ok = !url.includes('/login');
    await p.close();
  } catch (e) {
    err = String(e);
  }
  console.log(`login(${label}) -> ${url}  (authed=${ok})${err ? `  ERR ${err}` : ''}`);
  return ok;
}

const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const logins = {};

// ---- Surface 1: Host interested list (as r2host) ----
console.log('\n=== AUTHED (r2host): interested list ===');
const hostCtx = await browser.newContext(ctxOpts);
logins.host = await login(hostCtx, HOST_EMAIL, 'r2host');
if (logins.host) {
  await visit(hostCtx, 'host-interested', `/dates/${INSTANCE_ID}/interested`);
  // also capture the rate flow as the host (lock creator) participant
  await visit(hostCtx, 'host-rate', `/matches/${LOCK_ID}/rate`);
}
await hostCtx.close();

// ---- Surface 2 + 3: Offer detail + rate flow (as r2cand) ----
console.log('\n=== AUTHED (r2cand): offer detail + rate ===');
const candCtx = await browser.newContext(ctxOpts);
logins.cand = await login(candCtx, CAND_EMAIL, 'r2cand');
if (logins.cand) {
  await visit(candCtx, 'cand-offer', `/offers/${OFFER_ID}`);
  await visit(candCtx, 'cand-rate', `/matches/${LOCK_ID}/rate`);
}
await candCtx.close();

await browser.close();

writeFileSync(join(OUT, 'summary.json'), JSON.stringify({
  logins,
  ids: { INSTANCE_ID, OFFER_ID, LOCK_ID, HOST_EMAIL, CAND_EMAIL },
  results,
}, null, 2));
console.log(`\nDone. logins=${JSON.stringify(logins)}. Artifacts in ${OUT}`);
