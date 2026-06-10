// /api/stats must never 500: it's decorative social proof polled by public
// pages (the founder hit a console 500 on /dates/[slug]/interested when the
// dev server ran with an empty SUPABASE_SECRET_KEY). These tests pin the
// degraded paths: admin-client construction throwing, and query errors.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const adminState = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'throw' | 'query-error',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (adminState.mode === 'throw') {
      throw new Error('Supabase admin client: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY missing');
    }
    const err = adminState.mode === 'query-error' ? { message: 'relation "subscribers" does not exist' } : null;
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'not', 'order', 'eq']) chain[m] = () => chain;
    chain.limit = async () => ({
      data: err ? null : [{ first_name: 'mia', city: 'kelowna', created_at: '2026-06-01T00:00:00Z' }],
      error: err,
    });
    // head:true count query resolves the builder itself.
    chain.then = (resolve: (v: { count: number | null; error: unknown }) => void) =>
      resolve({ count: err ? null : 43, error: err });
    return { from: () => chain };
  },
}));

import { GET } from '../route';

beforeEach(() => {
  adminState.mode = 'ok';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/stats', () => {
  it('returns live counts and recent signups when the admin client works', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toBe(43);
    expect(body.remaining).toBe(57);
    expect(body.recent).toHaveLength(1);
  });

  it('degrades to an empty payload (200) when the admin client cannot be built', async () => {
    adminState.mode = 'throw';
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ claimed: 0, remaining: 100, cap: 100, recent: [] });
  });

  it('degrades to an empty payload (200) on a query error', async () => {
    adminState.mode = 'query-error';
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ claimed: 0, remaining: 100, cap: 100, recent: [] });
  });
});
