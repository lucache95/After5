import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Capture the realtime insert callback so we can simulate a live notification.
let insertCb: ((row: unknown) => void) | null = null;
const unsub = vi.fn();
vi.mock('@/lib/after5/realtime', () => ({
  subscribeNotifications: (_userId: string, cb: (row: unknown) => void) => { insertCb = cb; return unsub; },
}));

import { NotificationBadge } from '../NotificationBadge';

beforeEach(() => { insertCb = null; unsub.mockClear(); });

describe('NotificationBadge', () => {
  it('renders nothing when initial count is 0', () => {
    const { container } = render(<NotificationBadge userId="u1" initialCount={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the count when > 0', () => {
    render(<NotificationBadge userId="u1" initialCount={3} />);
    expect(screen.getByLabelText('3 unread notifications')).toHaveTextContent('3');
  });

  it('increments on a realtime insert', () => {
    render(<NotificationBadge userId="u1" initialCount={0} />);
    act(() => { insertCb?.({ id: 'n1' }); });
    expect(screen.getByLabelText('1 unread notifications')).toHaveTextContent('1');
  });

  it('decrements on a notif:read event with updated count', () => {
    render(<NotificationBadge userId="u1" initialCount={3} />);
    act(() => { window.dispatchEvent(new CustomEvent('notif:read', { detail: { updated: 2 } })); });
    expect(screen.getByLabelText('1 unread notifications')).toHaveTextContent('1');
  });

  it('clears on a notif:read {all:true} event', () => {
    const { container } = render(<NotificationBadge userId="u1" initialCount={5} />);
    act(() => { window.dispatchEvent(new CustomEvent('notif:read', { detail: { all: true } })); });
    expect(container.firstChild).toBeNull();
  });

  it('caps the display at 99+', () => {
    render(<NotificationBadge userId="u1" initialCount={150} />);
    expect(screen.getByLabelText('150 unread notifications')).toHaveTextContent('99+');
  });
});
