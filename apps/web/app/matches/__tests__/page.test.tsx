// apps/web/app/matches/__tests__/page.test.tsx
// Tests for the dates-tab page (/matches). Mocking pattern mirrors
// app/my-nights/__tests__/page.test.tsx (throwing redirect, swap-in mock client,
// unexpected tables throw).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { redirect, mockClient } = vi.hoisted(() => {
  const redirect = vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); });
  const mockClient = { current: undefined as Record<string, unknown> | undefined };
  return { redirect, mockClient };
});

vi.mock('next/navigation', () => ({
  redirect: (p: string) => redirect(p),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/BottomTabShell', () => ({ BottomTabShell: () => <nav data-testid="bottom-nav" /> }));
vi.mock('@/components/NotificationToast', () => ({ NotificationToast: () => null }));
vi.mock('@/lib/match/flag', () => ({ isMatchEnabledForViewer: async () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import Page from '../page';

interface LockFixture {
  id: string;
  status: string;
  creator_id: string;
  matched_user_id: string;
  creator: Record<string, unknown> | null;
  matched: Record<string, unknown> | null;
  instance: { id: string; starts_at: string; time_range: string | null; itinerary?: { title: string | null } | null } | null;
}

const profile = (id: string, name: string) => ({
  id, first_name: name, age: 30, city: 'kelowna', neighborhood: null, clear_photo_url: null, vibe_tags: [],
});

function buildClient(opts: { userId: string | null; locks?: LockFixture[] }) {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    from: (table: string) => {
      if (table !== 'locks') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({ order: async () => ({ data: opts.locks ?? [] }) }),
      };
    },
  };
}

const lock = (over: Partial<LockFixture> = {}): LockFixture => ({
  id: 'lock-1',
  status: 'active',
  creator_id: 'them',
  matched_user_id: 'me',
  creator: profile('them', 'maya'),
  matched: profile('me', 'self'),
  instance: { id: 'inst-1', starts_at: '2999-01-01T19:00:00Z', time_range: null, itinerary: { title: 'golden hour walk' } },
  ...over,
});

beforeEach(() => { redirect.mockClear(); });

describe('MatchesPage', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(Page()).rejects.toThrow(/REDIRECT:\/login\?next=\/matches/);
  });

  it('always mounts the bottom tab shell (tab destinations never dead-end)', async () => {
    mockClient.current = buildClient({ userId: 'me', locks: [] }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
  });

  it('renders the empty state with the feed CTA when there are no locks', async () => {
    mockClient.current = buildClient({ userId: 'me', locks: [] }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByText('no matches yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse tonight's nights/i })).toHaveAttribute('href', '/feed');
  });

  it('buckets a future active lock under upcoming and a completed one under past, surfacing the night title', async () => {
    mockClient.current = buildClient({
      userId: 'me',
      locks: [
        lock({ id: 'future' }),
        lock({
          id: 'wrapped',
          status: 'completed',
          creator: profile('them2', 'alex'),
          creator_id: 'them2',
          instance: { id: 'inst-2', starts_at: '2020-01-01T19:00:00Z', time_range: null, itinerary: { title: 'rooftop wine' } },
        }),
      ],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    expect(screen.getByRole('heading', { name: 'upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'past' })).toBeInTheDocument();
    // counterpart = the OTHER party (viewer is matched_user here)
    expect(screen.getByText('maya')).toBeInTheDocument();
    expect(screen.getByText('alex')).toBeInTheDocument();
    // the night title rides the existing instance embed
    expect(screen.getByText('golden hour walk')).toBeInTheDocument();
    expect(screen.getByText('rooftop wine')).toBeInTheDocument();
    // whole cards link through to the match detail
    expect(screen.getByRole('link', { name: /your date with maya/i })).toHaveAttribute('href', '/matches/future');
  });

  it('shows the rate CTA on a completed lock whose rating window is open', async () => {
    mockClient.current = buildClient({
      userId: 'me',
      locks: [lock({
        id: 'ratable',
        status: 'completed',
        instance: { id: 'inst-3', starts_at: '2020-01-01T19:00:00Z', time_range: null, itinerary: { title: 'pottery night' } },
      })],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByRole('link', { name: /rate it/i })).toHaveAttribute('href', '/matches/ratable/rate');
  });
});
