// apps/web/lib/after5/__tests__/realtime.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const unsubscribe = vi.fn();
const subscribe = vi.fn(() => ({ unsubscribe }));
const on = vi.fn(() => ({ subscribe }));
const channel = vi.fn(() => ({ on }));
const removeChannel = vi.fn();

const getSession = vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } }));
const setAuth = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ channel, removeChannel, auth: { getSession }, realtime: { setAuth } }),
}));

import { subscribeQueueInserts } from '../realtime';

beforeEach(() => { channel.mockClear(); on.mockClear(); subscribe.mockClear(); removeChannel.mockClear(); });

describe('subscribeQueueInserts', () => {
  it('opens a per-user channel filtered to queue_entries inserts for the instance', () => {
    const onInsert = vi.fn();
    subscribeQueueInserts('user-1', 'inst-1', onInsert);
    // Channel name carries a unique suffix (avoids topic-reuse collisions); assert the prefix.
    expect(channel).toHaveBeenCalledWith(expect.stringMatching(/^queue:user-1:/));
    const [evt, cfg] = on.mock.calls[0];
    expect(evt).toBe('postgres_changes');
    expect(cfg).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'queue_entries',
      filter: 'date_instance_id=eq.inst-1',
    });
  });

  it('forwards the new row to onInsert and returns a cleanup that removes the channel', () => {
    const onInsert = vi.fn();
    const cleanup = subscribeQueueInserts('user-1', 'inst-1', onInsert);
    const handler = on.mock.calls[0][2] as (p: { new: unknown }) => void;
    handler({ new: { id: 'q1', candidate_id: 'c1' } });
    expect(onInsert).toHaveBeenCalledWith({ id: 'q1', candidate_id: 'c1' });
    cleanup();
    expect(removeChannel).toHaveBeenCalled();
  });
});
