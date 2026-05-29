import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribe = vi.fn(() => ({}));
const on = vi.fn(() => ({ subscribe }));
const channel = vi.fn(() => ({ on }));
const removeChannel = vi.fn();

vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ channel, removeChannel }),
}));

import { subscribeLockInserts } from '../realtime';

beforeEach(() => { channel.mockClear(); on.mockClear(); subscribe.mockClear(); removeChannel.mockClear(); });

describe('subscribeLockInserts', () => {
  it('opens a per-user channel for locks inserts', () => {
    subscribeLockInserts('user-1', vi.fn());
    // Channel name carries a unique suffix (avoids topic-reuse collisions); assert the prefix.
    expect(channel).toHaveBeenCalledWith(expect.stringMatching(/^locks:user-1:/));
    const [evt, cfg] = on.mock.calls[0];
    expect(evt).toBe('postgres_changes');
    expect(cfg).toMatchObject({ event: 'INSERT', schema: 'public', table: 'locks' });
  });

  it('forwards the new row to onInsert and returns a cleanup that removes the channel', () => {
    const onInsert = vi.fn();
    const cleanup = subscribeLockInserts('user-1', onInsert);
    const handler = on.mock.calls[0][2] as (p: { new: unknown }) => void;
    handler({ new: { id: 'lock-1', creator_id: 'user-1' } });
    expect(onInsert).toHaveBeenCalledWith({ id: 'lock-1', creator_id: 'user-1' });
    cleanup();
    expect(removeChannel).toHaveBeenCalled();
  });
});
