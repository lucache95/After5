import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/after5/realtime', () => ({ subscribeNotifications: () => () => {} }));
// vaul passthrough — render children inline so list assertions work in jsdom.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Pass, { Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});

import { NotificationCenter } from '../NotificationCenter';

const sampleItems = [
  { id: 'n1', type: 'new_match', payload: { lock_id: 'l1' }, read_at: null, created_at: '2026-05-29T10:00:00Z' },
  { id: 'n2', type: 'offer_received', payload: { offer_id: 'o1' }, read_at: '2026-05-29T09:00:00Z', created_at: '2026-05-29T09:00:00Z' },
];

function mockFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('NotificationCenter', () => {
  it('renders rows with mapped labels after load', async () => {
    global.fetch = mockFetch({ items: sampleItems, nextCursor: null, unreadCount: 1 });
    render(<NotificationCenter userId="u1" initialCount={1} />);
    fireEvent.click(screen.getByLabelText('notifications'));
    await waitFor(() => expect(screen.getByText("it's a match")).toBeInTheDocument());
    expect(screen.getByText('a date wants you in')).toBeInTheDocument();
  });

  it('shows the empty state when items is empty', async () => {
    global.fetch = mockFetch({ items: [], nextCursor: null, unreadCount: 0 });
    render(<NotificationCenter userId="u1" initialCount={0} />);
    fireEvent.click(screen.getByLabelText('notifications'));
    await waitFor(() => expect(screen.getByText(/nothing yet/i)).toBeInTheDocument());
  });

  it('marks a row read on click: POST { ids:[id] } + notif:read event', async () => {
    const fetchMock = mockFetch({ items: sampleItems, nextCursor: null, unreadCount: 1 });
    global.fetch = fetchMock;
    const readEvent = vi.fn();
    window.addEventListener('notif:read', readEvent);
    render(<NotificationCenter userId="u1" initialCount={1} />);
    fireEvent.click(screen.getByLabelText('notifications'));
    await waitFor(() => expect(screen.getByText("it's a match")).toBeInTheDocument());

    fireEvent.click(screen.getByText("it's a match"));
    await waitFor(() => {
      const postCall = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({ ids: ['n1'] });
    });
    expect(readEvent).toHaveBeenCalled();
    window.removeEventListener('notif:read', readEvent);
  });
});
