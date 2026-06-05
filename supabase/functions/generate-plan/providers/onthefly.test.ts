import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildWarmRows, generateOnTheFly, FSQ_SEED_CATEGORY_IDS } from './onthefly.ts';
import { PipelineError } from './pipeline-error.ts';
import {
  richVenue,
  belowFloorVenue,
  nullHoursVenue,
} from '../__fixtures__/foursquare.ts';
import type { FsqResult } from '../foursquare.ts';

const city = { id: 'city-001', slug: 'kelowna' };
const KEY = 'fsq-test-key';

Deno.test('buildWarmRows: quality-floors below-7.0 ratings out (Area 1)', () => {
  const rows = buildWarmRows([richVenue, belowFloorVenue], city, KEY);
  // richVenue (8.4) admitted; belowFloorVenue (5.0) rejected by passesQualityFloor.
  assertEquals(rows.length, 1);
  assertEquals(rows[0].fsq_place_id, richVenue.fsq_place_id);
  assertEquals(rows[0].source, 'foursquare');
  assertEquals(rows[0].approval_status, 'auto');
});

Deno.test('buildWarmRows: dedupes by fsq_place_id (Area 1)', () => {
  const dup: FsqResult = { ...richVenue }; // same fsq_place_id
  const rows = buildWarmRows([richVenue, dup, nullHoursVenue], city, KEY);
  // richVenue + its duplicate collapse to one; nullHoursVenue (rating 7.8) admitted.
  assertEquals(rows.length, 2);
  const ids = rows.map((r) => r.fsq_place_id).sort();
  assertEquals(ids, [nullHoursVenue.fsq_place_id, richVenue.fsq_place_id].sort());
});

Deno.test('FSQ_SEED_CATEGORY_IDS: fixed server-side top-level id list (not user input)', () => {
  const ids = FSQ_SEED_CATEGORY_IDS.split(',');
  assertEquals(ids.length >= 4, true);
  // Dining & Drinking top-level id must be present (the primary date corpus).
  assertEquals(ids.includes('4d4b7105d754a06374d81259'), true);
});

// ─── generate() via the injectable seam ─────────────────────────────────────
type Deps = Parameters<typeof generateOnTheFly>[1];

function baseCtx(over: Record<string, unknown> = {}) {
  return {
    inputs: {} as Record<string, unknown>,
    city: { id: 'city-001', slug: 'kelowna', name: 'Kelowna', region: 'BC', centroid_lat: 49.888, centroid_lng: -119.496, default_radius_km: 25 },
    env: { anthropicKey: 'a', anthropicModel: 'm', foursquareKey: KEY },
    supabase: fakeDb({ count: 50 }),
    log: {} as Record<string, unknown>,
    ...over,
  };
}

// Minimal fake supabase: .from().select().eq().in().eq() head-count → { count }.
function fakeDb(opts: { count: number; upsertErr?: string }) {
  const chain: Record<string, unknown> = {};
  const proxy = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return undefined; // not a thenable
      if (prop === 'select' || prop === 'eq' || prop === 'in') {
        return () => proxyResult();
      }
      if (prop === 'upsert') {
        return async () => ({ error: opts.upsertErr ? { message: opts.upsertErr } : null });
      }
      if (prop === 'from') return () => proxyResult();
      return () => proxyResult();
    },
  });
  function proxyResult() {
    // A chainable object that also resolves to { count } when awaited (head:true count query).
    const obj: Record<string, unknown> = {
      select: () => proxyResult(),
      eq: () => proxyResult(),
      in: () => proxyResult(),
      upsert: async () => ({ error: opts.upsertErr ? { message: opts.upsertErr } : null }),
      then: (res: (v: { count: number }) => void) => res({ count: opts.count }),
    };
    return obj;
  }
  return { from: () => proxyResult() } as never;
}

const okDeps = (over: Partial<Deps> = {}): Deps => ({
  searchPlaces: async () => [richVenue, nullHoursVenue],
  runPipeline: async () => ({ itineraries: [{ id: 'it1' }] as never, modPool: [], modifierIdsPicked: [] }),
  ...over,
});

Deno.test('generate: throws generation_unavailable (503) when foursquareKey unset (Area 1)', async () => {
  const ctx = baseCtx({ env: { anthropicKey: 'a', anthropicModel: 'm' } });
  await assertRejects(
    () => generateOnTheFly(ctx as never, okDeps()),
    PipelineError,
    'not configured',
  );
});

Deno.test('generate: warm city (count >= threshold) skips the FSQ fetch and runs the pipeline', async () => {
  let fetched = false;
  const ctx = baseCtx({ supabase: fakeDb({ count: 50 }) });
  const res = await generateOnTheFly(ctx as never, okDeps({
    searchPlaces: async () => { fetched = true; return []; },
  }));
  assertEquals(fetched, false);
  assertEquals(res.itineraries.length, 1);
});

Deno.test('generate: cold city warms via Foursquare then runs pipeline with [live,auto]', async () => {
  let approvalStatuses: readonly string[] | undefined;
  const ctx = baseCtx({ supabase: fakeDb({ count: 0 }) });
  await generateOnTheFly(ctx as never, okDeps({
    runPipeline: async (_c, opts) => { approvalStatuses = opts?.approvalStatuses; return { itineraries: [{ id: 'it1' }] as never, modPool: [], modifierIdsPicked: [] }; },
  }));
  assertEquals(approvalStatuses, ['live', 'auto']);
});
