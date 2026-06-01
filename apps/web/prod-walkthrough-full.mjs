// Prod FULL walkthrough — comprehensive two-cohort production audit of tryafter5.app.
// Drives both cohort perspectives (r2host host-view + r2cand candidate-view) plus a
// logged-out public pass, with a Los_Angeles (PDT) timezone context so local-vs-UTC
// timestamps are distinguishable. Captures full-page mobile screenshots + per-page
// HTTP status, final URL, console errors, pageerrors, and a body-text snippet.
//
// READ-ONLY except for ONE allowed write: r2host sends a single chat message in the
// shared thread to confirm the live write path; r2cand then reads it. No swiping,
// offering, accepting, passing, or rating. No other mutations.
//
// Modeled on prod-walkthrough.mjs / prod-walkthrough-extra.mjs (same env-loading,
// adminMagicTokenHash() + /auth/confirm login, visit() helper, mobile viewport).
// Run from apps/web so @playwright/test resolves. Set APP_ENV_DIR to the primary
// checkout's apps/web if .env.local isn't in the worktree.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

// ROOT is where artifacts/reports are written. Defaults to this file's repo root,
// but OUT_ROOT lets a worktree run the script from another checkout (which has the
// installed @playwright/test) while still writing reports back into the worktree.
const ROOT = process.env.OUT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

const ENV_DIR = process.env.APP_ENV_DIR ?? join(ROOT, 'apps/web');
const env = {
  ...envFrom(join(ROOT, 'apps/web/.env')),
  ...envFrom(join(ROOT, 'apps/web/.env.local')),
  ...envFrom(join(ENV_DIR, '.env')),
  ...envFrom(join(ENV_DIR, '.env.local')),
};
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SECRET) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY. Set APP_ENV_DIR to a checkout with apps/web/.env.local');
  process.exit(1);
}
const PROD = 'https://tryafter5.app';

const HOST_EMAIL = 'lucache95+r2host@gmail.com';
const CAND_EMAIL = 'lucache95+r2cand@gmail.com';
const INSTANCE_ID = 'ae89bfeb-3132-4e5d-9bfd-7feaa65d12db';
const OFFER_ID = 'a2fca2d6-f671-44d0-bb26-e0bedb7431c4';
const LOCK_ID = '823aa47a-c5f8-4abe-a75a-59e874ed5627';
const THREAD_ID = '5880e07d-a9d1-402b-a7b6-aa3067b83acd';

const OUT = `${ROOT}/docs/superpowers/reports/prod-full-walkthrough-${new Date().toISOString().slice(0, 10)}`;
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

async function visit(context, label, path, opts = {}) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${String(e).slice(0, 240)}`));
  let status = null, finalUrl = null, err = null, bodyText = null;
  try {
    const resp = await page.goto(`${PROD}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(1500); // let client render/animate settle
    finalUrl = page.url();
    bodyText = ((await page.locator('body').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 800);
  } catch (e) {
    err = String(e).slice(0, 240);
    finalUrl = page.url();
  }
  const file = join(OUT, `${label}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { err = (err ?? '') + ` [screenshot: ${e}]`; }
  results.push({ label, path, status, finalUrl, redirected: finalUrl !== `${PROD}${path}`, consoleErrors, err, bodyText, file });
  console.log(`${status ?? 'ERR'}  ${label.padEnd(26)} ${path}  -> ${finalUrl}${consoleErrors.length ? `  (${consoleErrors.length} console err)` : ''}`);
  if (opts.keepOpen) return page;
  await page.close();
  return null;
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
const ctxOpts = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  timezoneId: 'America/Los_Angeles',
  locale: 'en-US',
};

const logins = {};
const chat = { sent: false, optimisticVisible: false, persistedHost: false, candVisible: false, sentText: null, err: null };

// ---- Logged-out public pass ----
console.log('\n=== LOGGED-OUT (public) ===');
const anon = await browser.newContext(ctxOpts);
for (const [label, path] of [
  ['anon-landing', '/'],
  ['anon-login', '/login'],
  ['anon-plan', '/plan'],
  ['anon-places', '/places'],
]) await visit(anon, label, path);
await anon.close();

// ---- Authed pass: r2host (host view) ----
console.log('\n=== AUTHED (r2host): host view ===');
const hostCtx = await browser.newContext(ctxOpts);
logins.host = await login(hostCtx, HOST_EMAIL, 'r2host');
if (logins.host) {
  await visit(hostCtx, 'host-home', '/home');
  await visit(hostCtx, 'host-feed', '/feed');
  await visit(hostCtx, 'host-my-nights', '/my-nights');
  await visit(hostCtx, 'host-interested', `/dates/${INSTANCE_ID}/interested`);
  await visit(hostCtx, 'host-matches', '/matches');
  await visit(hostCtx, 'host-match-detail', `/matches/${LOCK_ID}`);
  await visit(hostCtx, 'host-match-rate', `/matches/${LOCK_ID}/rate`);
  await visit(hostCtx, 'host-messages', '/messages');

  // ---- The ONE allowed write: send a single chat message as r2host ----
  console.log('\n--- CHAT SEND (r2host, single message) ---');
  const sentText = `walkthrough check ${new Date().toISOString().slice(11, 19)}`;
  chat.sentText = sentText;
  const tp = await hostCtx.newPage();
  const tpErrors = [];
  tp.on('console', (m) => { if (m.type() === 'error') tpErrors.push(m.text().slice(0, 240)); });
  tp.on('pageerror', (e) => tpErrors.push(`PAGEERROR: ${String(e).slice(0, 240)}`));
  try {
    await tp.goto(`${PROD}/messages/${THREAD_ID}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await tp.waitForTimeout(1500);
    await tp.screenshot({ path: join(OUT, 'host-thread-before.png'), fullPage: true });
    // Find the composer: textarea or text input
    const composer = tp.locator('textarea, input[type="text"]').last();
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
    await composer.click();
    await composer.fill(sentText);
    await tp.waitForTimeout(300);
    // Submit: prefer a send button; fall back to Enter
    const sendBtn = tp.locator('button[type="submit"], button:has-text("send")').last();
    if (await sendBtn.count()) {
      await sendBtn.click();
    } else {
      await composer.press('Enter');
    }
    await tp.waitForTimeout(1200);
    // optimistic / immediate render
    chat.optimisticVisible = await tp.getByText(sentText, { exact: false }).count() > 0;
    await tp.screenshot({ path: join(OUT, 'host-thread-after-send.png'), fullPage: true });
    // reload to confirm persistence
    await tp.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await tp.waitForTimeout(1500);
    chat.persistedHost = await tp.getByText(sentText, { exact: false }).count() > 0;
    await tp.screenshot({ path: join(OUT, 'host-thread-after-reload.png'), fullPage: true });
    chat.sent = chat.optimisticVisible || chat.persistedHost;
    console.log(`chat send: text="${sentText}" optimistic=${chat.optimisticVisible} persisted=${chat.persistedHost}`);
  } catch (e) {
    chat.err = String(e).slice(0, 300);
    console.log(`chat send FAILED: ${chat.err}`);
    try { await tp.screenshot({ path: join(OUT, 'host-thread-error.png'), fullPage: true }); } catch {}
  }
  if (tpErrors.length) {
    results.push({ label: 'host-thread-send', path: `/messages/${THREAD_ID}`, status: 'n/a', finalUrl: tp.url(), consoleErrors: tpErrors, err: null, bodyText: null, file: join(OUT, 'host-thread-after-reload.png') });
  }
  await tp.close();

  await visit(hostCtx, 'host-account', '/account');
}
await hostCtx.close();

// ---- Authed pass: r2cand (candidate view) ----
console.log('\n=== AUTHED (r2cand): candidate view ===');
const candCtx = await browser.newContext(ctxOpts);
logins.cand = await login(candCtx, CAND_EMAIL, 'r2cand');
if (logins.cand) {
  await visit(candCtx, 'cand-home', '/home');
  await visit(candCtx, 'cand-feed', '/feed');
  await visit(candCtx, 'cand-offer', `/offers/${OFFER_ID}`);
  await visit(candCtx, 'cand-matches', '/matches');
  await visit(candCtx, 'cand-messages', '/messages');
  // r2cand opens the same thread and should see the message r2host just sent
  const cp = await visit(candCtx, 'cand-thread', `/messages/${THREAD_ID}`, { keepOpen: true });
  try {
    chat.candVisible = chat.sentText ? (await cp.getByText(chat.sentText, { exact: false }).count() > 0) : false;
    console.log(`cand sees host message "${chat.sentText}": ${chat.candVisible}`);
  } catch (e) {
    console.log(`cand-thread read check failed: ${e}`);
  }
  await cp.close();
  await visit(candCtx, 'cand-account', '/account');
}
await candCtx.close();

await browser.close();

writeFileSync(join(OUT, 'summary.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  timezone: 'America/Los_Angeles',
  logins,
  chat,
  ids: { INSTANCE_ID, OFFER_ID, LOCK_ID, THREAD_ID, HOST_EMAIL, CAND_EMAIL },
  expectedLocalTimes: {
    instanceStartsAt: '2026-06-01 20:44 UTC = 1:44 PM PDT (8:44 PM = OLD UTC bug)',
    offerExpiresAt: '2026-06-01 18:59 UTC = 11:59 AM PDT',
  },
  results,
}, null, 2));
console.log(`\nDone. logins=${JSON.stringify(logins)} chat=${JSON.stringify(chat)}. Artifacts in ${OUT}`);
