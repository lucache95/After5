import { describe, it, expect, vi, beforeEach } from 'vitest';

let user: { id: string } | null = { id: 'u1' };
const captured: { update?: Record<string, unknown> } = {};

function qb() {
  const b: any = {};
  for (const m of ['select', 'eq', 'order', 'lt', 'is', 'in', 'limit']) b[m] = vi.fn(() => b);
  b.update = vi.fn((vals: Record<string, unknown>) => { captured.update = vals; return b; });
  b.then = (res: (v: { data: unknown[]; error: null; count: number }) => void) => res({ data: [], error: null, count: 0 });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => qb() }),
}));

import { GET, POST } from '../route';

beforeEach(() => { user = { id: 'u1' }; captured.update = undefined; });

describe('/api/notifications', () => {
  it('GET 401 when unauthenticated', async () => {
    user = null;
    const res = await GET(new Request('http://x/api/notifications') as never);
    expect(res.status).toBe(401);
  });

  it('GET returns items + unreadCount shape', async () => {
    const res = await GET(new Request('http://x/api/notifications?limit=20') as never);
    const json = await res.json();
    expect(json).toHaveProperty('items');
    expect(json).toHaveProperty('unreadCount');
  });

  it('POST mark-read updates ONLY read_at (RED-G1)', async () => {
    const res = await POST(new Request('http://x/api/notifications', {
      method: 'POST', body: JSON.stringify({ ids: ['n1'] }),
    }) as never);
    expect(res.status).toBe(200);
    expect(Object.keys(captured.update ?? {})).toEqual(['read_at']);
  });
});
