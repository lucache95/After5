// M3.5 custom venue — owner adds a real venue we don't carry to their date via the
// Google Places search panel. The /api/places/search proxy is MOCKED with page.route so
// the test is deterministic and runs without GOOGLE_PLACES_API_KEY in CI. Service-role
// seeds an itinerary OWNED by the test user; the user logs in via the PKCE helper, opens
// the custom-venue search, searches, and clicks "add to plan" — the new stop's name input
// then appears in the editor. (The queue insert is best-effort and not asserted here.)
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

let userId = '';
let itineraryId = '';
const email = `m3custom_${Date.now()}@test.local`;

test.beforeAll(async () => {
  const sb = admin();
  const { data: created, error: uErr } = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (uErr || !created.user) throw new Error(`seed user failed: ${uErr?.message}`);
  userId = created.user.id;
  const { data: it, error: iErr } = await sb
    .from('itineraries')
    .insert({
      user_id: userId,
      inputs: {},
      title: 'original night',
      stops: [
        { place_id: 'p1', place_name: 'clay studio', start_time: '18:00', duration_min: 90, estimated_cost_pp: 35, photo_url: null },
      ],
    })
    .select('id')
    .single();
  if (iErr || !it) throw new Error(`seed itinerary failed: ${iErr?.message}`);
  itineraryId = it.id as string;
});

test.afterAll(async () => {
  const sb = admin();
  if (itineraryId) {
    await sb.from('custom_venue_submissions').delete().eq('itinerary_id', itineraryId);
    await sb.from('itineraries').delete().eq('id', itineraryId);
  }
  if (userId) await sb.auth.admin.deleteUser(userId);
});

test('owner adds a custom venue to their plan via the (mocked) places proxy', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await loginAs(context, email);

  // Deterministic, key-independent: mock the proxy to return one custom stop.
  await page.route('**/api/places/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            place_id: 'custom:gtest1',
            place_name: 'hidden bean cafe',
            place_type: 'cafe',
            address: '42 quiet ln, kelowna',
            lat: 49.88,
            lng: -119.49,
            photo_url: null,
            start_time: '19:00',
            duration_min: 60,
            estimated_cost_pp: 0,
          },
        ],
      }),
    });
  });

  await page.goto(`/plans/${itineraryId}/edit`);
  // editor loaded with the seeded stop
  await expect(page.getByLabel(/^name$/i).first()).toHaveValue(/clay studio/i, { timeout: 15_000 });
  expect(await page.getByLabel(/^name$/i).count()).toBe(1);

  await page.getByLabel(/search for a place/i).fill('coffee');
  await page.getByRole('button', { name: /^search$/i }).click();

  await expect(page.getByText(/hidden bean cafe/i)).toBeVisible();
  await page.getByRole('button', { name: /add to plan/i }).click();

  // a second stop now exists, carrying the custom venue's name
  await expect(page.getByLabel(/^name$/i)).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByLabel(/^name$/i).nth(1)).toHaveValue(/hidden bean cafe/i);
});
