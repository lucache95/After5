// route-07 visual-capture — the AUTOMATED half of the Phase-7 phase-gate visual-verify
// (07-09 Task 1). Renders the six new/changed Phase-7 surfaces at the project's @420px
// mobile-first viewport against the forced-local stack and writes per-surface PNGs into
// the phase __visual__/ dir for the human critique. Mirrors 06-visual-capture.spec.ts.
//
// This is a throwaway CAPTURE spec, NOT a behavioral assertion suite — the E20..E25
// behavior lives in their own specs. It is GUARDED behind CAPTURE_VISUAL=1 so a bare
// `playwright test` (CI default set) skips it; run it explicitly with
//   CI=1 CAPTURE_VISUAL=1 \
//     pnpm --filter @after5/web exec playwright test e2e/route-07-visual.spec.ts
// (CI=1 so Playwright spawns its own LOCAL-pointed dev server, reuseExistingServer:false.)
//
// Surfaces captured (lowercase-kebab PNGs):
//   detail-map.png            — feed NightDetailSheet, coords present → the pink RouteMap renders (E20)
//   detail-coord-link.png     — same sheet, the per-stop "map" coord deep-link in PlanTimeline (E20)
//   lockdetail-venue-link.png — a matched LockDetail where a stop name links to /places/[slug] (E21)
//   nightcard-city-label.png  — the feed NightCard showing the lowercase city_name label (E23)
//   standby-card.png          — /inbox as a candidate with a pending 'interested' queue row (E24)
//   detail-skeleton.png       — the NightDetailSheet shimmer skeleton while detail pends (E25)
//   archive-tab.png           — the /my-nights upcoming/archive toggle (E25)
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs } from './_helpers/auth';
import {
  seedTwoUsersAndNight,
  seedChatThread,
  cleanup,
  cleanupChat,
  type SeedResult,
  type ChatSeedResult,
} from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  // Local Supabase demo service-role JWT fallback (same as the 05/06 capture specs) so the
  // spec is self-sufficient on the forced-local stack without exporting env first.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Project visual-verify standard: 420px-wide mobile-first viewport (the app centers in a
// max-w-[420px] phone container; capturing at this width is the canonical recipe).
const VIEWPORT = { width: 420, height: 900 };

// PNGs land in the phase dir for the Task-1 critique. process.cwd() is apps/web under
// `pnpm --filter @after5/web`, so walk up to the repo root.
const OUT_DIR = join(
  process.cwd(),
  '..',
  '..',
  '.planning',
  'phases',
  '07-enhancements-and-polish-p3',
  '__visual__',
);
mkdirSync(OUT_DIR, { recursive: true });
const out = (name: string) => join(OUT_DIR, name);

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Kelowna coords (~49.88,-119.49). Two real catalog places carrying lat/lng + a slug, so:
//   • the feed-map RPC (get_night_detail) LEFT JOINs places on `place_id` and merges
//     lat/lng/place_slug into each stop → the pink RouteMap + coord deep-links render (E20);
//   • the LockDetail loader reads itineraries.stops RAW and normalizes it (no places join),
//     so the rich stop JSON below ALSO carries place_slug + lat/lng directly → the post-lock
//     venue-name /places/[slug] link renders (E21).
const PLACES = [
  { slug: 'e2e-train-station-pub', name: 'The Train Station Pub', type: 'cocktail_bar', lat: 49.8881, lng: -119.4962, neighborhood: 'Downtown' },
  { slug: 'e2e-bean-scene-cafe', name: 'Bean Scene Cafe', type: 'cafe', lat: 49.8852, lng: -119.4951, neighborhood: 'Downtown' },
];

// Seed the two catalog places (idempotent on slug) and return their ids by slug.
async function seedPlaces(): Promise<Record<string, string>> {
  const sb = admin();
  const bySlug: Record<string, string> = {};
  for (const p of PLACES) {
    const { data, error } = await sb
      .from('places')
      .upsert(
        {
          name: p.name,
          slug: p.slug,
          neighborhood: p.neighborhood,
          drive_cluster: 'downtown',
          type: p.type,
          lat: p.lat,
          lng: p.lng,
        },
        { onConflict: 'slug' },
      )
      .select('id, slug')
      .single();
    if (error || !data) throw new Error(`seed place ${p.slug}: ${error?.message}`);
    bySlug[p.slug] = data.id as string;
  }
  return bySlug;
}

// Overwrite the host's itinerary stops with a RICH multi-stop plan whose stops carry
// place_id (for the feed-map RPC join) AND place_slug + lat/lng directly (for the
// LockDetail raw-stops normalizer). Two coord-bearing stops → RouteMap draws a route.
async function widenItineraryStops(hostId: string, placeIds: Record<string, string>): Promise<void> {
  const sb = admin();
  const stops = [
    {
      place_id: placeIds['e2e-train-station-pub'], place_name: 'The Train Station Pub',
      place_slug: 'e2e-train-station-pub', place_type: 'cocktail_bar', start_time: '19:00',
      duration_min: 90, estimated_cost_pp: 28, what_to_do: 'split the charcuterie',
      neighborhood: 'Downtown', lat: 49.8881, lng: -119.4962,
      local_insight: 'ask for the corner booth',
    },
    {
      place_id: placeIds['e2e-bean-scene-cafe'], place_name: 'Bean Scene Cafe',
      place_slug: 'e2e-bean-scene-cafe', place_type: 'cafe', start_time: '21:00',
      duration_min: 45, estimated_cost_pp: 12, what_to_do: 'a slow nightcap espresso',
      neighborhood: 'Downtown', lat: 49.8852, lng: -119.4951,
    },
  ];
  const { error } = await sb
    .from('itineraries')
    .update({ stops, total_cost_pp: 40, total_duration_min: 135 })
    .eq('user_id', hostId);
  if (error) throw new Error(`widen itinerary stops: ${error.message}`);
}

// Promote a seeded chat thread to a lock (mirrors 06-visual-capture's promoteThreadToLock):
// flip the instance to matched, insert an active lock + back-reference it from the thread.
async function promoteThreadToLock(seed: ChatSeedResult): Promise<string> {
  const sb = admin();
  await sb.from('date_instances').update({ status: 'matched' }).eq('id', seed.instanceId);
  const { data: lock, error } = await sb
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
  if (error || !lock) throw new Error(`locks insert: ${error?.message}`);
  const lockId = lock.id as string;
  await sb.from('chat_threads').update({ lock_id: lockId }).eq('id', seed.threadId);
  return lockId;
}

// Insert the candidate's own pending-interest queue row for E24 standby. rank=1 →
// "you're next in line". RLS is bypassed for this setup write; the StandbyList read
// runs under the candidate's own RLS client.
async function seedInterestedQueueRow(seed: SeedResult, rank: number): Promise<void> {
  const sb = admin();
  const { error } = await sb.from('queue_entries').upsert(
    {
      date_instance_id: seed.instanceId,
      candidate_id: seed.candId,
      // queue_entries carries the host as creator_id (not-null); the candidate's RLS read
      // (queue_candidate_read_own) scopes on candidate_id, so this is setup-only.
      creator_id: seed.hostId,
      status: 'interested',
      rank,
    },
    { onConflict: 'date_instance_id,candidate_id' },
  );
  if (error) throw new Error(`seed interested queue row: ${error.message}`);
}

// Open the feed detail sheet by tapping the active card (Enter activates the role=button
// card → onOpenDetail). Waits for the sheet's blind reassurance copy to confirm it opened.
async function openDetailSheet(candPage: Page): Promise<void> {
  await candPage.goto('/feed');
  await expect(candPage.getByRole('button', { name: /interested/i })).toBeVisible({ timeout: 20_000 });
  // The card itself is a role=button; Enter opens the detail drawer.
  const card = candPage.getByRole('button', { name: /tap to read the full plan/i }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.press('Enter');
}

// Guard: a bare `playwright test` (CI default set) must NOT run this capture spec.
const RUN = process.env.CAPTURE_VISUAL === '1';

test.describe('07 visual-capture @420px (forced-local, CAPTURE_VISUAL=1)', () => {
  test.skip(!RUN, 'set CAPTURE_VISUAL=1 to run the visual-capture spec');
  test.use({ viewport: VIEWPORT });

  // E25-skeleton: the feed NightDetailSheet shimmer skeleton while get_night_detail pends.
  // Its own seed + page so the stall has no interplay with the map/coord captures.
  test('E25 feed detail: in-sheet shimmer skeleton (pending)', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      const places = await seedPlaces();
      await widenItineraryStops(seed.hostId, places);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);

      // Stall get_night_detail so the in-sheet shimmer holds while it pends. Capture the
      // skeleton the instant the drawer opens, before the RPC route resolves.
      await candPage.route('**/rest/v1/rpc/get_night_detail', async (route) => {
        await new Promise((r) => setTimeout(r, 6000));
        await route.continue();
      });
      await openDetailSheet(candPage);
      const skeleton = candPage.getByTestId('detail-skeleton');
      await expect(skeleton).toBeVisible({ timeout: 10_000 });
      await candPage.waitForTimeout(250);
      await candPage.screenshot({ path: out('detail-skeleton.png') });

      await ctx.close();
    } finally {
      await cleanup(seed);
    }
  });

  // E20: the feed NightDetailSheet with coords present → the real pink RouteMap renders
  // under "the route", and the per-stop "map" link deep-links coordinates. No RPC stall.
  test('E20 feed detail: route map + coord deep-link', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      const places = await seedPlaces();
      await widenItineraryStops(seed.hostId, places);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await openDetailSheet(candPage);

      // (a) detail-map — the pink static RouteMap renders under "the route".
      const mapBtn = candPage.getByRole('button', { name: /expand the route map/i });
      await expect(mapBtn).toBeVisible({ timeout: 20_000 });
      // Let the Mapbox static PNG load before the shot.
      await candPage.waitForTimeout(1500);
      await mapBtn.scrollIntoViewIfNeeded();
      await candPage.waitForTimeout(400);
      await candPage.screenshot({ path: out('detail-map.png') });

      // (b) detail-coord-link — the per-stop "map" link now deep-links coords. Scroll the
      // timeline (the first stop's map link) into frame and shoot it.
      const coordLink = candPage.getByRole('link', { name: /^map$/i }).first();
      await expect(coordLink).toBeVisible({ timeout: 15_000 });
      await expect(coordLink).toHaveAttribute('href', /google\.com\/maps\/search.*query=49\.8881,-119\.4962/);
      await coordLink.scrollIntoViewIfNeeded();
      await candPage.waitForTimeout(300);
      await candPage.screenshot({ path: out('detail-coord-link.png') });

      await ctx.close();
    } finally {
      await cleanup(seed);
    }
  });

  // E23: the feed NightCard shows the lowercase city_name label ("kelowna").
  test('E23 nightcard: lowercase city label', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await candPage.goto('/feed');
      await expect(candPage.getByRole('button', { name: /interested/i })).toBeVisible({ timeout: 20_000 });
      // The city label is rendered verbatim-lowercased on the card meta row (E23).
      await expect(candPage.getByText(/^kelowna$/i).first()).toBeVisible({ timeout: 15_000 });
      await candPage.waitForTimeout(600);
      await candPage.screenshot({ path: out('nightcard-city-label.png') });
      await ctx.close();
    } finally {
      await cleanup(seed);
    }
  });

  // E21: a matched LockDetail where a stop name links to /places/[slug] (the only
  // linkSlugs=true caller). The rich stop JSON carries place_slug → the name is a link.
  test('E21 lockdetail: stop name links to /places/[slug]', async ({ browser }) => {
    const seed = await seedChatThread();
    try {
      const places = await seedPlaces();
      await widenItineraryStops(seed.hostId, places);
      const lockId = await promoteThreadToLock(seed);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await candPage.goto(`/matches/${lockId}`);
      expect(candPage.url(), 'lock page bounced to /login → seed/login failed').not.toContain('/login');
      // The post-lock plan timeline links the catalog stop's name to /places/[slug].
      const venueLink = candPage.getByRole('link', { name: /the train station pub/i });
      await expect(venueLink).toBeVisible({ timeout: 20_000 });
      await expect(venueLink).toHaveAttribute('href', '/places/e2e-train-station-pub');
      await venueLink.scrollIntoViewIfNeeded();
      await candPage.waitForTimeout(400);
      await candPage.screenshot({ path: out('lockdetail-venue-link.png') });
      await ctx.close();
    } finally {
      await cleanupChat(seed);
    }
  });

  // E24: /inbox as a candidate with a pending 'interested' queue row → the StandbyCard
  // (position line + soft sub-line + neutral "pull my interest" control).
  test('E24 standby: candidate queue card on /inbox', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      await seedInterestedQueueRow(seed, 1);

      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const candPage = await loginAs(ctx, seed.candEmail);
      await candPage.goto('/inbox');
      expect(candPage.url(), 'inbox bounced to /login → seed/login failed').not.toContain('/login');
      // The standby section + card render under the "your queue" eyebrow.
      await expect(candPage.getByText(/your queue/i)).toBeVisible({ timeout: 20_000 });
      await expect(candPage.getByText(/you're next in line/i)).toBeVisible({ timeout: 15_000 });
      await expect(candPage.getByRole('button', { name: /pull my interest/i })).toBeVisible();
      await candPage.waitForTimeout(400);
      await candPage.screenshot({ path: out('standby-card.png') });
      await ctx.close();
    } finally {
      await cleanup(seed);
    }
  });

  // E25-archive: the /my-nights upcoming/archive segment toggle (capture the host view).
  test('E25 archive: /my-nights upcoming/archive toggle', async ({ browser }) => {
    const seed = await seedTwoUsersAndNight();
    try {
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const hostPage = await loginAs(ctx, seed.hostEmail);
      await hostPage.goto('/my-nights');
      expect(hostPage.url(), 'my-nights bounced to /login → seed/login failed').not.toContain('/login');
      // The two-segment toggle (upcoming default + archive) is a tablist.
      await expect(hostPage.getByRole('tab', { name: /^upcoming$/i })).toBeVisible({ timeout: 20_000 });
      await expect(hostPage.getByRole('tab', { name: /^archive$/i })).toBeVisible();
      await hostPage.waitForTimeout(400);
      await hostPage.screenshot({ path: out('archive-tab.png') });
      await ctx.close();
    } finally {
      await cleanup(seed);
    }
  });
});
