// m3-canvas-visual — throwaway CAPTURE spec for the converged customization canvas
// (/plans/[id]/edit): AI title chips under the title input + ImproveControls before
// the save/publish CTAs (city_id-gated). Mirrors route-07-visual.spec.ts; guarded
// behind CAPTURE_VISUAL=1 so a bare `playwright test` skips it. Run with:
//   CI=1 CAPTURE_VISUAL=1 pnpm --filter @after5/web exec playwright test e2e/m3-canvas-visual.spec.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const VIEWPORT = { width: 420, height: 900 };
const OUT_DIR = '/tmp/canvas-verify';
mkdirSync(OUT_DIR, { recursive: true });
const out = (name: string) => join(OUT_DIR, name);

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Make the seeded itinerary look like a real generated night: two named stops so the
// editor renders a multi-stop canvas, the title chips gate (hasNamedStop) opens, and
// ImproveControls lists per-stop swap rows. city_id is already set by the seed.
async function enrichStops(hostId: string): Promise<string> {
  const sb = admin();
  const stops = [
    {
      place_name: 'The Train Station Pub', place_type: 'cocktail_bar', start_time: '19:00',
      duration_min: 90, estimated_cost_pp: 28, what_to_do: 'split the charcuterie',
      neighborhood: 'Downtown', lat: 49.8881, lng: -119.4962,
      local_insight: 'ask for the corner booth',
    },
    {
      place_name: 'Bean Scene Cafe', place_type: 'cafe', start_time: '21:00',
      duration_min: 45, estimated_cost_pp: 12, what_to_do: 'a slow nightcap espresso',
      neighborhood: 'Downtown', lat: 49.8852, lng: -119.4951,
    },
  ];
  const { data, error } = await sb
    .from('itineraries')
    .update({ stops, title: 'pub crawl, but make it soft', total_cost_pp: 40, total_duration_min: 135 })
    .eq('user_id', hostId)
    .select('id')
    .single();
  if (error || !data) throw new Error(`enrich stops: ${error?.message}`);
  return data.id as string;
}

const RUN = process.env.CAPTURE_VISUAL === '1';

test.describe('m3 canvas visual-capture @420px (forced-local, CAPTURE_VISUAL=1)', () => {
  test.skip(!RUN, 'set CAPTURE_VISUAL=1 to run the visual-capture spec');
  test.use({ viewport: VIEWPORT });

  test('converged canvas: title chips + ImproveControls + publish', async ({ browser }) => {
    let seed: SeedResult | null = null;
    seed = await seedTwoUsersAndNight();
    try {
      const itineraryId = await enrichStops(seed.hostId);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const hostPage = await loginAs(ctx, seed.hostEmail);
      await hostPage.goto(`/plans/${itineraryId}/edit`);
      expect(hostPage.url(), 'edit page bounced to /login → seed/login failed').not.toContain('/login');

      // Canvas anchors: title input, the four AI title chips, ImproveControls, publish CTA.
      await expect(hostPage.getByRole('heading', { name: /edit your night/i })).toBeVisible({ timeout: 20_000 });
      const chips = hostPage.getByLabel('title takes');
      await expect(chips.getByRole('button', { name: /^another take$/i })).toBeVisible();
      await expect(chips.getByRole('button', { name: /^more romantic$/i })).toBeVisible();
      await expect(chips.getByRole('button', { name: /^more playful$/i })).toBeVisible();
      await expect(chips.getByRole('button', { name: /^more casual$/i })).toBeVisible();
      await expect(hostPage.getByText(/not quite right\?/i)).toBeVisible();
      await expect(hostPage.getByRole('button', { name: /publish this night/i })).toBeVisible();

      // SOUND check: the word "regenerate" must appear NOWHERE in the rendered page.
      const bodyText = await hostPage.locator('body').innerText();
      expect(bodyText.toLowerCase()).not.toContain('regenerate');

      // (a) full editor page — the whole canvas top to bottom.
      await hostPage.waitForTimeout(600);
      await hostPage.screenshot({ path: out('canvas-full.png'), fullPage: true });

      // (b) chips row — title input + the AI title chips in frame.
      await hostPage.getByLabel('title', { exact: true }).scrollIntoViewIfNeeded();
      await hostPage.evaluate(() => window.scrollTo(0, 0));
      await hostPage.waitForTimeout(300);
      await hostPage.screenshot({ path: out('canvas-title-chips.png') });

      // (c) ImproveControls block relative to save/publish — scroll the save button
      // into frame so the improve block + CTAs share the shot.
      await hostPage.getByRole('button', { name: /save changes/i }).scrollIntoViewIfNeeded();
      await hostPage.waitForTimeout(300);
      await hostPage.screenshot({ path: out('canvas-improve-vs-ctas.png') });

      // (d) ImproveControls block itself, top-aligned.
      await hostPage.getByText(/not quite right\?/i).scrollIntoViewIfNeeded();
      await hostPage.evaluate(() => window.scrollBy(0, -80));
      await hostPage.waitForTimeout(300);
      await hostPage.screenshot({ path: out('canvas-improve-block.png') });

      // Horizontal-overflow probe at 420px (clipping check for the critique).
      const overflow = await hostPage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      console.log(`[m3-canvas-visual] horizontal overflow px: ${overflow}`);

      await ctx.close();
    } finally {
      if (seed) await cleanup(seed);
    }
  });
});
