import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribe = vi.fn(() => ({}));
const on = vi.fn(() => ({ subscribe }));
const channel = vi.fn(() => ({ on }));
const removeChannel = vi.fn();

const getSession = vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } }));
const setAuth = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ channel, removeChannel, auth: { getSession }, realtime: { setAuth } }),
}));

import { subscribeThreadMessages } from '../realtime';

beforeEach(() => { channel.mockClear(); on.mockClear(); subscribe.mockClear(); removeChannel.mockClear(); });

describe('subscribeThreadMessages', () => {
  it('opens a per-thread channel for messages inserts with a thread_id filter', () => {
    subscribeThreadMessages('thread-1', vi.fn());
    // Channel name carries a unique suffix (avoids topic-reuse collisions); assert the prefix.
    expect(channel).toHaveBeenCalledWith(expect.stringMatching(/^chat:thread-1:/));
    const [evt, cfg] = on.mock.calls[0];
    expect(evt).toBe('postgres_changes');
    expect(cfg).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: 'thread_id=eq.thread-1',
    });
  });

  it('forwards payload.new to onInsert and returns a cleanup that removes the channel', () => {
    const onInsert = vi.fn();
    const cleanup = subscribeThreadMessages('thread-1', onInsert);
    const handler = on.mock.calls[0][2] as (p: { new: unknown }) => void;
    handler({ new: { id: 'm-1', thread_id: 'thread-1', sender_id: 'u-1', body: 'hi' } });
    expect(onInsert).toHaveBeenCalledWith({ id: 'm-1', thread_id: 'thread-1', sender_id: 'u-1', body: 'hi' });
    cleanup();
    expect(removeChannel).toHaveBeenCalled();
  });
});
