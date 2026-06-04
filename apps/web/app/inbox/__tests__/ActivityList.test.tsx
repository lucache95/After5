import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/after5/realtime', () => ({ subscribeNotifications: () => () => {} }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...rest }: { children?: React.ReactNode }) => <li {...rest}>{children}</li> }),
  useReducedMotion: () => true,
}));

import { ActivityList } from '../ActivityList';
import type { ActivityItem } from '@/lib/after5/inbox-activity';

const items: ActivityItem[] = [
  { kind: 'single', id: 'n1', type: 'new_match', payload: { lock_id: 'l1' }, read_at: null, created_at: '2026-06-01T10:00:00Z' },
  { kind: 'group', id: 'interest_received:d1', type: 'interest_received', ids: ['a', 'b', 'c'], count: 3, groupKey: 'd1', created_at: '2026-06-01T09:00:00Z', anyUnread: true, payload: { date_instance_id: 'd1' } },
];

beforeEach(() => { vi.restoreAllMocks(); push.mockReset(); });

describe('ActivityList', () => {
  it('renders a single row and a counted group row', () => {
    render(<ActivityList userId="u1" initialItems={items} initialCursor={null} />);
    expect(screen.getByText("it's a match")).toBeInTheDocument();
    expect(screen.getByText("3 someone's into your night")).toBeInTheDocument();
  });

  it('marks ALL group members read on tap (POST { ids:[a,b,c] }) and deep-links', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    global.fetch = fetchMock;
    const readEvent = vi.fn();
    window.addEventListener('notif:read', readEvent);

    render(<ActivityList userId="u1" initialItems={items} initialCursor={null} />);
    fireEvent.click(screen.getByText("3 someone's into your night"));

    await waitFor(() => {
      const post = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ ids: ['a', 'b', 'c'] });
    });
    expect(readEvent).toHaveBeenCalled();
    // E8/D-07: an interest_received group deep-links the host to that night's interested
    // list (payload.date_instance_id='d1'), not the generic /my-nights surface.
    expect(push).toHaveBeenCalledWith('/dates/d1/interested');
    window.removeEventListener('notif:read', readEvent);
  });

  it('mark all read posts { all:true }', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    global.fetch = fetchMock;
    render(<ActivityList userId="u1" initialItems={items} initialCursor={null} />);
    fireEvent.click(screen.getByText('mark all read'));
    await waitFor(() => {
      const post = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ all: true });
    });
  });

  it('collapses past the inline limit behind "see all activity"', () => {
    const many: ActivityItem[] = Array.from({ length: 8 }, (_, i) => ({
      kind: 'single', id: `n${i}`, type: 'new_match', payload: null, read_at: null, created_at: `2026-06-01T0${i}:00:00Z`,
    }));
    render(<ActivityList userId="u1" initialItems={many} initialCursor={null} />);
    // 5 inline + the "see all" affordance; tapping it reveals the rest.
    expect(screen.getAllByText("it's a match")).toHaveLength(5);
    fireEvent.click(screen.getByText('see all activity →'));
    expect(screen.getAllByText("it's a match")).toHaveLength(8);
  });
});
