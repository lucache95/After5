// M3 date customization — owner edits a real itinerary in a browser and the change
// persists. Drives the real flow against the local stack: service-role seeds an
// itinerary OWNED by the test user, the user logs in via the PKCE helper, renames a
// stop in /plans/<id>/edit, saves (real update_itinerary_stops RPC), and after reload
// the editor shows the persisted name. No mocks — this proves the RPC + RLS + UI wire end-to-end.
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
const email = `m3edit_${Date.now()}@test.local`;

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
  if (itineraryId) await sb.from('itineraries').delete().eq('id', itineraryId);
  if (userId) await sb.auth.admin.deleteUser(userId);
});

test('owner edits an itinerary stop and the change persists', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await loginAs(context, email);

  await page.goto(`/plans/${itineraryId}/edit`);
  const nameInput = page.getByLabel(/^name$/i).first();
  await expect(nameInput).toHaveValue(/clay studio/i, { timeout: 15_000 });

  await nameInput.fill('pottery loft');
  await page.getByRole('button', { name: /save/i }).click();
  // optimistic save → sonner success; then the value survives a reload (DB persisted)
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByLabel(/^name$/i).first()).toHaveValue(/pottery loft/i, { timeout: 15_000 });
});
