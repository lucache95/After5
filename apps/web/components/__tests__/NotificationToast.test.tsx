import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

let insertCb: ((row: unknown) => void) | null = null;
const unsub = vi.fn();
vi.mock('@/lib/after5/realtime', () => ({
  subscribeNotifications: (_userId: string, cb: (row: unknown) => void) => { insertCb = cb; return unsub; },
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const toast = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }));

import { NotificationToast } from '../NotificationToast';

beforeEach(() => { insertCb = null; unsub.mockClear(); push.mockClear(); toast.mockClear(); });

describe('NotificationToast', () => {
  it('renders no visible DOM', () => {
    const { container } = render(<NotificationToast userId="u1" />);
    expect(container.firstChild).toBeNull();
  });

  it('fires a toast with the mapped label on a realtime insert', () => {
    render(<NotificationToast userId="u1" />);
    insertCb?.({ id: 'n1', type: 'new_match', payload: { lock_id: 'l1' } });
    expect(toast).toHaveBeenCalledWith("it's a match", expect.objectContaining({
      action: expect.objectContaining({ label: 'view' }),
    }));
  });

  it('toast action deeplinks via the per-type map', () => {
    render(<NotificationToast userId="u1" />);
    insertCb?.({ id: 'n1', type: 'new_match', payload: { lock_id: 'l1' } });
    const opts = toast.mock.calls[0][1] as { action: { onClick: () => void } };
    opts.action.onClick();
    expect(push).toHaveBeenCalledWith('/matches/l1');
  });
});
