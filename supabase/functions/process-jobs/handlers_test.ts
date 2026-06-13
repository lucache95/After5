// supabase/functions/process-jobs/handlers_test.ts
import { assertEquals, assert, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { HANDLERS } from './handlers.ts';
import { makeSeedCity } from './seed-city.ts';
import { richVenue, belowFloorVenue } from '../generate-plan/__fixtures__/foursquare.ts';

const ALL_TYPES = [
  'offer_expiry','standby_roll','bulk_withdraw',
  'chat_purge','rating_window','analytics_relay','seed_city','notify',
  'deletion_process',
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

// ── deletion_process (ACCT-01) ───────────────────────────────────────────────
// A fake Db: rpc(process_account_deletion) returns SETOF text (storage paths);
// storage.from(bucket).remove(paths) captures the keys; auth.admin.deleteUser(uid)
// captures the user. No network, no key, no live DB.
function fakeDeletionDb(opts: {
  rpcResult?: { data: unknown; error: { code?: string; message: string } | null };
  removeError?: { message: string } | null;
  deleteUserError?: { message: string } | null;
} = {}) {
  const captured = {
    rpcCalls: [] as Array<{ fn: string; args: unknown }>,
    removeBucket: null as string | null,
    removePaths: null as string[] | null,
    deletedUser: null as string | null,
  };
  const db = {
    rpc: (fn: string, args: unknown) => {
      captured.rpcCalls.push({ fn, args });
      return Promise.resolve(opts.rpcResult ?? { data: ['u1/a.jpg', 'u1/a_blurred.jpg'], error: null });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          captured.removeBucket = bucket;
          captured.removePaths = paths;
          return Promise.resolve({ data: null, error: opts.removeError ?? null });
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: (uid: string) => {
          captured.deletedUser = uid;
          return Promise.resolve({ data: null, error: opts.deleteUserError ?? null });
        },
      },
    },
    from: () => { throw new Error('deletion_process must not write tables directly'); },
  };
  return { db, captured };
}

Deno.test('deletion_process anonymizes, purges photos in profile-photos, removes auth user', async () => {
  const { db, captured } = fakeDeletionDb();
  await HANDLERS['deletion_process'](db as never, {
    id: 'jd', type: 'deletion_process', payload: { user: 'u1' }, run_after: '', status: 'running',
  } as never);

  assert(captured.rpcCalls.some((c) => c.fn === 'process_account_deletion'), 'did not call process_account_deletion');
  assertEquals((captured.rpcCalls[0].args as { p_user: string }).p_user, 'u1');
  assertEquals(captured.removeBucket, 'profile-photos', 'must purge the profile-photos bucket');
  assertEquals(captured.removePaths, ['u1/a.jpg', 'u1/a_blurred.jpg']);
  assertEquals(captured.deletedUser, 'u1', 'must remove the auth user');
});

Deno.test('deletion_process throws when payload.user missing (fail-loud → retry)', async () => {
  const { db } = fakeDeletionDb();
  await assertRejects(
    () => HANDLERS['deletion_process'](db as never, { id: 'jd', type: 'deletion_process', payload: {}, run_after: '', status: 'running' } as never),
    Error,
    'payload.user is required',
  );
});

Deno.test('deletion_process tolerates a not-found auth user on retry (idempotent)', async () => {
  const { db, captured } = fakeDeletionDb({ deleteUserError: { message: 'User not found' } });
  // must NOT throw — a retry after a prior successful auth delete drains cleanly
  await HANDLERS['deletion_process'](db as never, {
    id: 'jd', type: 'deletion_process', payload: { user: 'u1' }, run_after: '', status: 'running',
  } as never);
  assertEquals(captured.deletedUser, 'u1');
});

Deno.test('deletion_process re-throws a genuine auth delete failure (retry)', async () => {
  const { db } = fakeDeletionDb({ deleteUserError: { message: 'service unavailable' } });
  await assertRejects(
    () => HANDLERS['deletion_process'](db as never, { id: 'jd', type: 'deletion_process', payload: { user: 'u1' }, run_after: '', status: 'running' } as never),
    Error,
    'auth deleteUser failed',
  );
});

Deno.test('deletion_process skips storage purge when no paths returned', async () => {
  const { db, captured } = fakeDeletionDb({ rpcResult: { data: [], error: null } });
  await HANDLERS['deletion_process'](db as never, {
    id: 'jd', type: 'deletion_process', payload: { user: 'u1' }, run_after: '', status: 'running',
  } as never);
  assertEquals(captured.removePaths, null, 'must not call storage.remove with no paths');
  assertEquals(captured.deletedUser, 'u1');
});
