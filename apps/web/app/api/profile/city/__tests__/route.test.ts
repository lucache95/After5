import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// The route writes primary_city_id under the RLS-bound server client (self-scope
// via .eq('id', user.id)) and fires enqueueSeedCity(cityId) fire-and-forget.

const VALID_CITY = '11111111-1111-1111-1111-111111111111';

let user: { id: string } | null = { id: 'u1' };
// cities lookup result: a row means the cityId references an active curated city.
let cityRow: unknown = { id: VALID_CITY };
let updateError: { message: string } | null = null;

const updateSpy = vi.fn();

// A chainable query-builder mock. `from('cities')` resolves a maybeSingle lookup;
// `from('profiles')` records the update + self-scoping eq.
function from(table: string) {
  const b: any = {};
  if (table === 'cities') {
    b.select = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.maybeSingle = vi.fn(async () => ({ data: cityRow, error: null }));
    return b;
  }
  // profiles
  b.update = vi.fn((patch: Record<string, unknown>) => {
    updateSpy(patch);
    return b;
  });
  b.eq = vi.fn(async (col: string, val: unknown) => {
    b._eqCol = col;
    b._eqVal = val;
    updateSpy.eqCol = col;
    updateSpy.eqVal = val;
    return { error: updateError };
  });
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => from(t),
  }),
}));

const enqueueSeedCity = vi.fn();
vi.mock('@/lib/after5/enqueue-seed-city', () => ({
  enqueueSeedCity: (...a: unknown[]) => enqueueSeedCity(...a),
}));

import { POST } from '../route';

function post(body: unknown) {
  return POST(
    new Request('http://x/api/profile/city', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  );
}

beforeEach(() => {
  user = { id: 'u1' };
  cityRow = { id: VALID_CITY };
  updateError = null;
  updateSpy.mockReset();
  enqueueSeedCity.mockReset();
  enqueueSeedCity.mockResolvedValue({ enqueued: true });
});

describe('POST /api/profile/city', () => {
  it('writes primary_city_id self-scoped and fires enqueueSeedCity → 200 {ok:true}', async () => {
    const res = await post({ cityId: VALID_CITY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(updateSpy).toHaveBeenCalledWith({ primary_city_id: VALID_CITY });
    // self-scoped to the authed user
    expect(updateSpy.eqCol).toBe('id');
    expect(updateSpy.eqVal).toBe('u1');

    expect(enqueueSeedCity).toHaveBeenCalledWith(VALID_CITY);
  });

  it('401 for an unauthenticated request and never writes or enqueues', async () => {
    user = null;
    const res = await post({ cityId: VALID_CITY });
    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(enqueueSeedCity).not.toHaveBeenCalled();
  });

  it('400 for a malformed cityId and never writes or enqueues', async () => {
    const res = await post({ cityId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(enqueueSeedCity).not.toHaveBeenCalled();
  });

  it('400 for an unknown/inactive city id (not in cities where is_active) — no write', async () => {
    cityRow = null;
    const res = await post({ cityId: VALID_CITY });
    expect(res.status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(enqueueSeedCity).not.toHaveBeenCalled();
  });

  it('a rejecting enqueue never fails the request → still 200 (fire-and-forget)', async () => {
    enqueueSeedCity.mockRejectedValue(new Error('queue down'));
    const res = await post({ cityId: VALID_CITY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalled();
  });
});
