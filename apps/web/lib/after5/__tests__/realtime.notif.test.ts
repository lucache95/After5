import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribe = vi.fn(() => ({}));
const on = vi.fn(() => ({ subscribe }));
const channel = vi.fn(() => ({ on }));
const removeChannel = vi.fn();

vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ channel, removeChannel }) }));

import { subscribeNotifications } from '../realtime';

beforeEach(() => { channel.mockClear(); on.mockClear(); subscribe.mockClear(); removeChannel.mockClear(); });

describe('subscribeNotifications', () => {
  it('opens a per-user channel for notifications inserts', () => {
    subscribeNotifications('user-1', vi.fn());
    // Channel name carries a unique suffix (avoids topic-reuse collisions); assert the prefix.
    expect(channel).toHaveBeenCalledWith(expect.stringMatching(/^notif:user-1:/));
    const [evt, cfg] = on.mock.calls[0];
    expect(evt).toBe('postgres_changes');
    expect(cfg).toMatchObject({ event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.user-1' });
  });

  it('forwards the new row and returns a cleanup', () => {
    const onInsert = vi.fn();
    const cleanup = subscribeNotifications('user-1', onInsert);
    const handler = on.mock.calls[0][2] as (p: { new: unknown }) => void;
    handler({ new: { id: 'n1', type: 'new_match', user_id: 'user-1' } });
    expect(onInsert).toHaveBeenCalledWith({ id: 'n1', type: 'new_match', user_id: 'user-1' });
    cleanup();
    expect(removeChannel).toHaveBeenCalled();
  });
});
