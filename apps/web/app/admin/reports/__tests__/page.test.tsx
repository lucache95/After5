import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// requireAdmin is the fail-closed gate; assert the page awaits it. createAdminClient
// is the service-role reader; we stub its query builder to return canned rows.
const requireAdmin = vi.fn(async () => ({ email: 'admin@after5.test' }));
const limit = vi.fn();

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: (path: string) => requireAdmin(path),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({ limit }),
      }),
    }),
  }),
}));

// LocalTime is a 'use client' component; render its iso inline for the test.
vi.mock('@/components/LocalTime', () => ({
  LocalTime: ({ iso }: { iso: string | null }) => <span>{iso}</span>,
}));

import AdminReportsPage from '../page';

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    reason: 'harassment',
    created_at: '2026-06-01T12:00:00Z',
    reporter: { first_name: 'Reporter' },
    message: {
      id: 'msg-1',
      body: 'this is the reported message body',
      created_at: '2026-06-01T11:55:00Z',
      sender: { first_name: 'Sender' },
      thread: { id: 'thread-1', state: 'open', offer: { id: 'offer-1' } },
    },
    ...overrides,
  };
}

describe('AdminReportsPage', () => {
  beforeEach(() => {
    requireAdmin.mockClear();
    limit.mockReset();
  });

  it('calls requireAdmin (fail-closed gate) with the route path', async () => {
    limit.mockResolvedValue({ data: [], error: null });
    render(await AdminReportsPage());
    expect(requireAdmin).toHaveBeenCalledWith('/admin/reports');
  });

  it('renders a report row with message body, reporter, sender, and reason', async () => {
    limit.mockResolvedValue({ data: [reportRow()], error: null });
    render(await AdminReportsPage());

    expect(screen.getByText('this is the reported message body')).toBeInTheDocument();
    expect(screen.getByText('Reporter')).toBeInTheDocument(); // reporter first_name
    expect(screen.getByText(/Message from Sender/)).toBeInTheDocument(); // sender first_name
    expect(screen.getByText('harassment')).toBeInTheDocument(); // reason
    expect(screen.getByText('1 report')).toBeInTheDocument();
    expect(screen.getByText(/offer: offer-1/)).toBeInTheDocument(); // thread/offer context
  });

  it('renders the on-brand empty state when there are no reports', async () => {
    limit.mockResolvedValue({ data: [], error: null });
    render(await AdminReportsPage());

    expect(screen.getByText(/No reports\./)).toBeInTheDocument();
    expect(screen.getByText('report_message')).toBeInTheDocument();
    expect(screen.getByText('0 reports')).toBeInTheDocument();
  });

  it('tolerates a missing reporter/sender/thread (null embeds) without throwing', async () => {
    limit.mockResolvedValue({
      data: [reportRow({ reporter: null, reason: null, message: { id: 'm', body: 'b', created_at: '2026-06-01T11:00:00Z', sender: null, thread: null } })],
      error: null,
    });
    render(await AdminReportsPage());

    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('(none given)')).toBeInTheDocument(); // null reason fallback
    expect(screen.getByText(/Message from unknown/)).toBeInTheDocument(); // null sender fallback
  });
});
