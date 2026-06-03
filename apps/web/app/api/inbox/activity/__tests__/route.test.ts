import { describe, it, expect, vi, beforeEach } from 'vitest';

let user: { id: string } | null = { id: 'u1' };
// Rows the RLS-bound select returns (newest first). The route excludes new_message
// at the DB layer via .neq; the mock doesn't enforce that, so we omit new_message
// from the fixture and assert the GROUPING transform instead.
let rows: unknown[] = [];

function qb() {
  const b: any = {};
  for (const m of ['select', 'eq', 'order', 'lt', 'is', 'in', 'limit', 'neq']) b[m] = vi.fn(() => b);
  b.then = (res: (v: { data: unknown[]; error: null; count: number }) => void) =>
    res({ data: rows, error: null, count: 2 });
  return b;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => qb() }),
}));

import { GET } from '../route';

beforeEach(() => { user = { id: 'u1' }; rows = []; });

describe('/api/inbox/activity', () => {
  it('401 when unauthenticated', async () => {
    user = null;
    const res = await GET(new Request('http://x/api/inbox/activity') as never);
    expect(res.status).toBe(401);
  });

  it('groups interest_received by date_instance_id and returns the feed shape', async () => {
    rows = [
      { id: 'a', type: 'interest_received', payload: { date_instance_id: 'd1' }, read_at: null, created_at: '2026-06-01T03:00:00Z' },
      { id: 'b', type: 'interest_received', payload: { date_instance_id: 'd1' }, read_at: null, created_at: '2026-06-01T02:00:00Z' },
      { id: 'c', type: 'new_match', payload: { lock_id: 'l1' }, read_at: null, created_at: '2026-06-01T01:00:00Z' },
    ];
    const res = await GET(new Request('http://x/api/inbox/activity') as never);
    const json = await res.json();
    expect(json).toHaveProperty('items');
    expect(json).toHaveProperty('nextCursor');
    expect(json).toHaveProperty('unreadCount');
    expect(json.items).toHaveLength(2);
    const group = json.items.find((i: { kind: string }) => i.kind === 'group');
    expect(group.count).toBe(2);
    expect(group.ids).toEqual(['a', 'b']);
  });
});
