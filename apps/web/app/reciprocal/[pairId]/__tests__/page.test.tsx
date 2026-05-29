// apps/web/app/reciprocal/[pairId]/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { redirect, mockClient } = vi.hoisted(() => {
  const redirect = vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); });
  const mockClient = { current: undefined as Record<string, unknown> | undefined };
  return { redirect, mockClient };
});

vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }));
vi.mock('../ReciprocalChooser', () => ({ ReciprocalChooser: (p: { instanceA: { id: string }; instanceB: { id: string } }) => <div data-testid="chooser" data-a={p.instanceA.id} data-b={p.instanceB.id} /> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));

import Page from '../page';

type Pair = { id: string; high_user: string; low_user: string; status?: string };
function client(opts: { userId: string | null; pair?: Pair | null; offers?: unknown[] }) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }) },
    from: (table: string) => {
      if (table === 'reciprocal_pairs') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.pair ?? null }) }) }) };
      }
      // offers: .select(...).eq('status','active').or(...) resolves to { data }
      return { select: () => ({ eq: () => ({ or: async () => ({ data: opts.offers ?? [] }) }) }) };
    },
  };
}

// An offer row shaped to the page's select (date_instance + itinerary embed).
function offer(o: { id: string; instance: string; creator: string; candidate: string; title: string; starts: string }) {
  return {
    id: o.id, date_instance_id: o.instance, creator_id: o.creator, candidate_id: o.candidate, status: 'active',
    date_instance: { id: o.instance, starts_at: o.starts, creator_id: o.creator, itinerary: { title: o.title, cover_image_url: null } },
  };
}

beforeEach(() => { redirect.mockClear(); });

describe('reciprocal page', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = client({ userId: null }) as Record<string, unknown>;
    await expect(Page({ params: Promise.resolve({ pairId: 'pair-1' }) })).rejects.toThrow(/REDIRECT:\/login/);
  });

  it('403s when the user is not a party to the pair', async () => {
    mockClient.current = client({ userId: 'stranger', pair: { id: 'pair-1', high_user: 'h', low_user: 'l', status: 'open' } }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ pairId: 'pair-1' }) });
    render(ui);
    expect(screen.getByText(/not your decision/i)).toBeInTheDocument();
  });

  it('renders both competing instances, viewer-owned first', async () => {
    mockClient.current = client({
      userId: 'u-lo',
      pair: { id: 'pair-1', high_user: 'u-hi', low_user: 'u-lo', status: 'open' },
      offers: [
        offer({ id: 'o1', instance: 'inst-a', creator: 'u-lo', candidate: 'u-hi', title: 'jazz bar', starts: '2026-06-01T02:00:00Z' }),
        offer({ id: 'o2', instance: 'inst-b', creator: 'u-hi', candidate: 'u-lo', title: 'pottery', starts: '2026-06-02T02:00:00Z' }),
      ],
    }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ pairId: 'pair-1' }) });
    render(ui);
    const chooser = screen.getByTestId('chooser');
    expect(chooser.getAttribute('data-a')).toBe('inst-a'); // viewer u-lo created inst-a
    expect(chooser.getAttribute('data-b')).toBe('inst-b');
  });

  it('shows a stale state when fewer than two live instances remain', async () => {
    mockClient.current = client({
      userId: 'u-lo',
      pair: { id: 'pair-1', high_user: 'u-hi', low_user: 'u-lo', status: 'open' },
      offers: [offer({ id: 'o1', instance: 'inst-a', creator: 'u-lo', candidate: 'u-hi', title: 'jazz bar', starts: '2026-06-01T02:00:00Z' })],
    }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ pairId: 'pair-1' }) });
    render(ui);
    expect(screen.getByText(/nothing to choose/i)).toBeInTheDocument();
  });
});
