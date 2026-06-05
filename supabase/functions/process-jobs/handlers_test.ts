// supabase/functions/process-jobs/handlers_test.ts
import { assertEquals, assert, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { HANDLERS } from './handlers.ts';
import { makeSeedCity } from './seed-city.ts';
import { richVenue, belowFloorVenue } from '../generate-plan/__fixtures__/foursquare.ts';

const ALL_TYPES = [
  'offer_expiry','standby_roll','bulk_withdraw',
  'chat_purge','rating_window','analytics_relay','seed_city','notify',
];

Deno.test('every job_type has a handler', () => {
  for (const t of ALL_TYPES) assert(typeof HANDLERS[t] === 'function', `missing handler ${t}`);
});

Deno.test('offer_expiry calls match_expire_offer (no direct offer write)', async () => {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const fakeDb = {
    rpc: (name: string, args: unknown) => { rpcCalls.push({ name, args }); return Promise.resolve({ data: null, error: null }); },
    from: () => { throw new Error('handler must not write tables directly'); },
  };
  await HANDLERS['offer_expiry'](fakeDb as never, {
    id: 'j1', type: 'offer_expiry', payload: { offer_id: 'o1' }, run_after: '', status: 'running',
  } as never);
  assert(rpcCalls.some((c) => c.name === 'match_expire_offer'), 'did not call match_expire_offer');
});

// ── seed_city (DATA-02) ──────────────────────────────────────────────────────
// A fake supabase client: cities.select(...).eq(...).maybeSingle() returns a city;
// places.upsert(rows, opts) captures the rows + onConflict; cities.update(patch)
// captures the seeded_at stamp. No network, no key.
function fakeSeedDb(opts: { city: Record<string, unknown> | null }) {
  const captured = {
    upsertRows: null as unknown[] | null,
    upsertOpts: null as Record<string, unknown> | null,
    seededAtPatch: null as Record<string, unknown> | null,
  };
  const db = {
    from(table: string) {
      if (table === 'cities') {
        return {
          // read: .select().eq().maybeSingle()
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.city, error: null }),
            }),
          }),
          // write: .update(patch).eq()
          update: (patch: Record<string, unknown>) => {
            captured.seededAtPatch = patch;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'places') {
        return {
          upsert: (rows: unknown[], upsertOpts: Record<string, unknown>) => {
            captured.upsertRows = rows;
            captured.upsertOpts = upsertOpts;
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db, captured };
}

const SEED_CITY = {
  id: 'city-1', slug: 'portland', name: 'Portland',
  default_radius_km: 30, centroid_lat: 45.52, centroid_lng: -122.68,
};

Deno.test('seed_city upserts onConflict fsq_place_id and stamps cities.seeded_at', async () => {
  const { db, captured } = fakeSeedDb({ city: SEED_CITY });
  // Stub searchPlaces: one usable venue (rating 8.4 ≥ floor) + one below-floor
  // (rating 5.0) so we also prove the quality floor drops it before upsert.
  const handler = makeSeedCity({
    searchPlaces: () => Promise.resolve([richVenue, belowFloorVenue]),
    getKey: () => 'test-key',
  });
  await handler(db as never, {
    id: 'j-seed', type: 'seed_city', payload: { city_id: 'city-1' }, run_after: '', status: 'running',
  } as never);

  assert(captured.upsertRows !== null, 'did not upsert places');
  assertEquals(captured.upsertOpts?.onConflict, 'fsq_place_id', 'upsert arbiter must be fsq_place_id');
  // belowFloorVenue (rating 5.0) is dropped by passesQualityFloor — only the rich one remains.
  assertEquals(captured.upsertRows!.length, 1, 'quality floor should drop the below-floor venue');
  assertEquals((captured.upsertRows![0] as { fsq_place_id: string }).fsq_place_id, richVenue.fsq_place_id);
  assert(captured.seededAtPatch !== null && typeof captured.seededAtPatch.seeded_at === 'string', 'did not stamp seeded_at');
});

Deno.test('seed_city throws on missing city_id (fail-loud → retry)', async () => {
  const { db } = fakeSeedDb({ city: SEED_CITY });
  const handler = makeSeedCity({
    searchPlaces: () => Promise.resolve([richVenue]),
    getKey: () => 'test-key',
  });
  await assertRejects(
    () => handler(db as never, { id: 'j', type: 'seed_city', payload: {}, run_after: '', status: 'running' } as never),
    Error,
    'city_id is required',
  );
});

Deno.test('seed_city throws when city not found (fail-loud → retry)', async () => {
  const { db } = fakeSeedDb({ city: null });
  const handler = makeSeedCity({
    searchPlaces: () => Promise.resolve([richVenue]),
    getKey: () => 'test-key',
  });
  await assertRejects(
    () => handler(db as never, { id: 'j', type: 'seed_city', payload: { city_id: 'missing' }, run_after: '', status: 'running' } as never),
    Error,
    'not found',
  );
});
