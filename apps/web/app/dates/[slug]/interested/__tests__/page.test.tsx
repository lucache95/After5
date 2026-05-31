// apps/web/app/dates/[slug]/interested/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { redirect, mockClient } = vi.hoisted(() => {
  const redirect = vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); });
  const mockClient = { current: undefined as Record<string, unknown> | undefined };
  return { redirect, mockClient };
});

vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }));
vi.mock('../InterestedList', () => ({ InterestedList: (props: { candidates: unknown[] }) => <div data-testid="list" data-count={props.candidates.length} /> }));
vi.mock('@/components/ComingSoonBanner', () => ({ ComingSoonBanner: () => <div data-testid="coming-soon" /> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));

import Page from '../page';

function buildClient(opts: {
  userId: string | null; creatorId?: string; flag?: boolean;
  candidates?: unknown[]; offer?: unknown; windowHours?: number;
}) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }) },
    // isMatchEnabledForViewer() now gates via the app_match_enabled_self() RPC
    // instead of a raw feature_config read; the flag option drives its result.
    rpc: async (_fn: string) => ({ data: opts.flag ?? true, error: null }),
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, _v: string) => ({
          maybeSingle: async () => {
            if (table === 'date_instances') return { data: { id: 'inst-1', creator_id: opts.creatorId } };
            if (table === 'feature_config') return { data: { value: opts.flag ?? true } };
            return { data: null };
          },
          order: () => ({ then: undefined }),
        }),
      }),
    }),
  };
}

beforeEach(() => { redirect.mockClear(); });

describe('interested page', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(Page({ params: Promise.resolve({ slug: 'inst-1' }) })).rejects.toThrow(/REDIRECT:\/login/);
  });

  it('renders a not-your-date 403 state for a non-host', async () => {
    mockClient.current = buildClient({ userId: 'u2', creatorId: 'host-1' }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ slug: 'inst-1' }) });
    render(ui);
    expect(screen.getByText(/not your date/i)).toBeInTheDocument();
  });

  it('renders ComingSoonBanner when the flag is off', async () => {
    mockClient.current = buildClient({ userId: 'host-1', creatorId: 'host-1', flag: false }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ slug: 'inst-1' }) });
    render(ui);
    expect(screen.getByTestId('coming-soon')).toBeInTheDocument();
  });
});
