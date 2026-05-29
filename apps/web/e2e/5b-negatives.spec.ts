// 5b negatives (spec §4.6): expired offer, account-gated (P5002), concurrent accept.
// The account-gated + concurrent-accept assertions hit the match-* edge contract
// directly (the edge response is the contract surface). Edge functions verify the
// JWT, so every direct POST carries a real Bearer pulled from the signed-in
// context's auth cookie (apikey alone → 401). Error-code facts verified against
// supabase/functions/_shared/errcode.ts: account_gated=P5002 (409),
// time_conflict=P5004 (409), offer_expired=P5007 (410).
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs, accessToken } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUBLISHABLE_KEY =
  process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

let seed: SeedResult;
test.beforeAll(async () => {
  seed = await seedTwoUsersAndNight();
});
test.afterAll(async () => {
  if (seed) await cleanup(seed);
});

test('expired offer: candidate sees expired state, cannot accept', async ({ browser }) => {
  const sb = admin();
  // Seed an already-expired offer directly (service-role).
  const { data: offer, error } = await sb
    .from('offers')
    .insert({
      date_instance_id: seed.instanceId,
      creator_id: seed.hostId,
      candidate_id: seed.candId,
      status: 'active',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();

  const candContext = await browser.newContext();
  const candPage = await loginAs(candContext, seed.candEmail);
  await candPage.goto(`/offers/${offer!.id}`);
  await expect(candPage.getByText(/expired/i)).toBeVisible();
  await expect(candPage.getByRole('button', { name: /^accept$/i })).toBeDisabled();
  await candContext.close();

  // Clear it so the later concurrent-accept test starts from one active offer.
  await sb.from('offers').delete().eq('id', offer!.id);
});

test('account-gated: make_offer to an unverified recipient surfaces P5002', async ({ browser }) => {
  const sb = admin();
  // Demote the candidate so the recipient eligibility gate fails.
  await sb.from('profiles').update({ verification: 'unverified', dating_enabled: false }).eq('id', seed.candId);

  const hostContext = await browser.newContext();
  await loginAs(hostContext, seed.hostEmail); // host SSR session cookies in this context
  const token = await accessToken(hostContext);
  // Assert the edge contract directly (UI may not expose the recipient's gate reason).
  const res = await hostContext.request.post(`${SUPABASE_URL}/functions/v1/match-make-offer`, {
    headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { instance: seed.instanceId, candidate: seed.candId },
  });
  const body = await res.json();
  expect([400, 403, 409, 422], JSON.stringify(body)).toContain(res.status());
  expect(JSON.stringify(body)).toMatch(/P5002|account_gated/i);

  // Restore for downstream isolation.
  await sb.from('profiles').update({ verification: 'verified', dating_enabled: true }).eq('id', seed.candId);
  await hostContext.close();
});

test('concurrent accept: two racing POSTs on one offer → exactly one wins', async ({ browser }) => {
  const sb = admin();
  const { data: offer, error } = await sb
    .from('offers')
    .insert({
      date_instance_id: seed.instanceId,
      creator_id: seed.hostId,
      candidate_id: seed.candId,
      status: 'active',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();

  const candContext = await browser.newContext();
  await loginAs(candContext, seed.candEmail);
  const token = await accessToken(candContext);
  const post = () =>
    candContext.request.post(`${SUPABASE_URL}/functions/v1/match-accept-offer`, {
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { offer: offer!.id },
    });
  const [a, b] = await Promise.all([post(), post()]);
  const oks = [a.status(), b.status()].filter((s) => s === 200).length;
  expect(oks, `expected exactly one winner; got statuses ${a.status()}/${b.status()}`).toBe(1);
  const loser = a.status() === 200 ? b : a;
  const loserBody = JSON.stringify(await loser.json());
  expect(loserBody).toMatch(/time_conflict|offer_expired|already|P50\d\d/i);
  await candContext.close();
});
