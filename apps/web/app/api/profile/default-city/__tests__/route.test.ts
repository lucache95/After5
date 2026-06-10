import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// The route backfills profiles.primary_city_id with the launch city (slug
// lookup, never a hardcoded uuid) under the RLS-bound server client. It must be
// IDEMPOTENT (never overwrite a non-null city) and TOLERANT (a missing launch
// city no-ops instead of failing the preferences save).

const KELOWNA_ID = '22222222-2222-2222-2222-222222222222';

let user: { id: string } | null = { id: 'u1' };
let profileRow: { primary_city_id: string | null } | null = { primary_city_id: null };
let cityRow: { id: string } | null = { id: KELOWNA_ID };
let updateError: { message: string } | null = null;

const updateSpy = vi.fn();
const citySlugEq = vi.fn();

function from(table: string) {
  const b: any = {};
  if (table === 'cities') {
    b.select = vi.fn(() => b);
    b.eq = vi.fn((col: string, val: unknown) => {
      citySlugEq(col, val);
      return b;
    });
    b.maybeSingle = vi.fn(async () => ({ data: cityRow, error: null }));
    return b;
  }
  // profiles — first call path is the select, second the update
  b.select = vi.fn(() => b);
  b.update = vi.fn((patch: Record<string, unknown>) => {
    updateSpy(patch);
    return b;
  });
  b.eq = vi.fn((col: string, val: unknown) => {
    updateSpy.eqCol = col;
    updateSpy.eqVal = val;
    return b;
  });
  b.is = vi.fn(async (col: string, val: unknown) => {
    updateSpy.isCol = col;
    updateSpy.isVal = val;
    return { error: updateError };
  });
  b.maybeSingle = vi.fn(async () => ({ data: profileRow, error: null }));
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => from(t),
  }),
}));

import { POST } from '../route';

beforeEach(() => {
  user = { id: 'u1' };
  profileRow = { primary_city_id: null };
  cityRow = { id: KELOWNA_ID };
  updateError = null;
  updateSpy.mockReset();
  citySlugEq.mockReset();
});

describe('POST /api/profile/default-city', () => {
  it('null city → looks up the launch city BY SLUG and writes it null-guarded → defaulted:true', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, defaulted: true });

    // slug lookup, never a hardcoded uuid
    expect(citySlugEq).toHaveBeenCalledWith('slug', 'kelowna');
    expect(citySlugEq).toHaveBeenCalledWith('is_active', true);

    expect(updateSpy).toHaveBeenCalledWith({ primary_city_id: KELOWNA_ID });
    // self-scoped + write-time idempotency guard (.is null)
    expect(updateSpy.eqCol).toBe('id');
    expect(updateSpy.eqVal).toBe('u1');
    expect(updateSpy.isCol).toBe('primary_city_id');
    expect(updateSpy.isVal).toBe(null);
  });

  it('IDEMPOTENT: an existing primary_city_id is never overwritten → defaulted:false, no write', async () => {
    profileRow = { primary_city_id: 'already-set-city' };
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, defaulted: false });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('TOLERANT: launch city row missing → 200 no-op (the funnel must not stall)', async () => {
    cityRow = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, defaulted: false });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('401 for an unauthenticated request — no reads, no writes', async () => {
    user = null;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('missing profile row → 200 no-op (nothing to default)', async () => {
    profileRow = null;
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, defaulted: false });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('a failing update surfaces as 500 (caller swallows it; the save itself already succeeded)', async () => {
    updateError = { message: 'boom' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST();
    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
