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
// Client component (usePathname) — stub for this server-page unit test.
vi.mock('@/components/BottomTabShell', () => ({ BottomTabShell: () => <nav data-testid="tab-bar" /> }));
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
      select: () => {
        // Self-returning chain so .eq().eq()… , .order().limit() all resolve.
        type Chain = {
          eq: () => Chain;
          order: () => Chain;
          limit: () => Promise<{ data: unknown[] }>;
          maybeSingle: () => Promise<{ data: unknown }>;
        };
        const chain: Chain = {
          eq: () => chain,
          order: () => chain,
          limit: async () => ({ data: opts.candidates ?? [] }),
          maybeSingle: async () => {
            if (table === 'date_instances') return { data: { id: 'inst-1', creator_id: opts.creatorId } };
            if (table === 'feature_config') return { data: { value: opts.windowHours ?? 24 } };
            if (table === 'offers') return { data: opts.offer ?? null };
            return { data: null };
          },
        };
        return chain;
      },
    }),
  };
}

beforeEach(() => { redirect.mockClear(); });

describe('interested page', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(Page({ params: Promise.resolve({ slug: 'inst-1' }) })).rejects.toThrow(/REDIRECT:\/login/);
  });

  it('renders a not-your-date 403 state for a non-host (with the tab bar)', async () => {
    mockClient.current = buildClient({ userId: 'u2', creatorId: 'host-1' }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ slug: 'inst-1' }) });
    render(ui);
    expect(screen.getByText(/not your date/i)).toBeInTheDocument();
    expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
  });

  it('renders the host list with a tab bar, a back arrow, and no "your interest" label', async () => {
    mockClient.current = buildClient({ userId: 'host-1', creatorId: 'host-1' }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ slug: 'inst-1' }) });
    render(ui);
    expect(screen.getByTestId('list')).toBeInTheDocument();
    // Standing rule: every host surface keeps the bottom menu.
    expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
    // Drill-in back affordance stays; the candidate-side label does not.
    expect(screen.getByRole('link', { name: /back to your nights/i })).toBeInTheDocument();
    expect(screen.queryByText(/your interest/i)).not.toBeInTheDocument();
  });

  it('renders ComingSoonBanner when the flag is off', async () => {
    mockClient.current = buildClient({ userId: 'host-1', creatorId: 'host-1', flag: false }) as Record<string, unknown>;
    const ui = await Page({ params: Promise.resolve({ slug: 'inst-1' }) });
    render(ui);
    expect(screen.getByTestId('coming-soon')).toBeInTheDocument();
  });
});
