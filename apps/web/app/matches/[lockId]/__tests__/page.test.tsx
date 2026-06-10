// apps/web/app/matches/[lockId]/__tests__/page.test.tsx
// Loader-level tests for the match-detail page: tab-shell presence (a dates-tab
// leaf never dead-ends), the night data riding the get_lock_night_detail RPC
// (fix-02: title + normalized stops, party-gated, locked/past nights return),
// and the isRatingOpen derivation both ways.
// Mocking pattern mirrors app/matches/__tests__/page.test.tsx (throwing
// redirect, swap-in mock client, unexpected tables throw). LockDetail itself is
// stubbed to a prop probe — its rendering contract lives in LockDetail.test.tsx.
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
vi.mock('@/components/DeepRouteHeader', () => ({
  DeepRouteHeader: ({ backHref, backLabel }: { backHref: string; backLabel: string }) => (
    <a data-testid="back-link" href={backHref}>{backLabel}</a>
  ),
}));
vi.mock('@/lib/match/flag', () => ({ isMatchEnabledForViewer: async () => true }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));
vi.mock('@/lib/after5/photos', () => ({
  listMyPhotos: async () => [],
  signClearUrls: async () => [],
}));
// Prop probe: the page's job is loader wiring, not markup.
vi.mock('../LockDetail', () => ({
  LockDetail: (p: {
    ratingOpen: boolean;
    nightTitle?: string | null;
    stops?: { name: string }[];
    startsAt?: string | null;
  }) => (
    <div
      data-testid="lock-detail"
      data-rating-open={String(p.ratingOpen)}
      data-night-title={p.nightTitle ?? ''}
      data-stops={(p.stops ?? []).map((s) => s.name).join('|')}
      data-starts-at={p.startsAt ?? ''}
    />
  ),
}));

import Page from '../page';

const profile = (id: string, name: string) => ({
  id, first_name: name, age: 30, city: 'kelowna', neighborhood: null, clear_photo_url: null, vibe_tags: [],
});

interface LockFixture {
  id: string;
  status: string;
  creator_id: string;
  matched_user_id: string;
  creator: Record<string, unknown> | null;
  matched: Record<string, unknown> | null;
  instance: Record<string, unknown> | null;
  thread: { id: string } | null;
}

const lock = (over: Partial<LockFixture> = {}): LockFixture => ({
  id: 'lock-1',
  status: 'active',
  creator_id: 'them',
  matched_user_id: 'me',
  creator: profile('them', 'maya'),
  matched: profile('me', 'self'),
  instance: {
    id: 'inst-1',
    starts_at: '2999-01-01T19:00:00Z',
    time_range: null,
  },
  thread: { id: 'thread-1' },
  ...over,
});

// fix-02: the night plan comes from the get_lock_night_detail RPC, not an embed.
const night = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  date_instance_id: 'inst-1',
  time_window_start: '2999-01-01T19:00:00Z',
  title: 'jazz bar + late night ramen',
  vibe_tags: ['boozy'],
  stops: [
    { place_name: 'Rooftop Bar', place_type: 'bar', start_time: '19:00' },
    { place_name: 'Late-Night Ramen', place_type: 'food', start_time: '21:00' },
  ],
  ...over,
});

function buildClient(opts: {
  userId: string | null;
  lock?: LockFixture | null;
  night?: Record<string, unknown> | null;
}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    rpc: async (fn: string) => {
      if (fn !== 'get_lock_night_detail') throw new Error(`unexpected rpc: ${fn}`);
      return { data: opts.night ? [opts.night] : [], error: null };
    },
    from: (table: string) => {
      if (table === 'locks') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.lock ?? null }) }) }) };
      }
      // active locks derive the soft reconfirm/check-in flags — empty is fine here.
      if (table === 'notifications') {
        return {
          select: () => ({ in: () => ({ eq: () => ({ filter: () => ({ order: async () => ({ data: [] }) }) }) }) }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const call = (lockId = 'lock-1') =>
  Page({ params: Promise.resolve({ lockId }), searchParams: Promise.resolve({}) });

beforeEach(() => { redirect.mockClear(); });

describe('LockPage', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(call()).rejects.toThrow(/REDIRECT:\/login\?next=\/matches\/lock-1/);
  });

  it('mounts the bottom tab shell + back-to-matches affordance (payoff screen never dead-ends)', async () => {
    mockClient.current = buildClient({ userId: 'me', lock: lock(), night: night() }) as Record<string, unknown>;
    const ui = await call();
    render(ui);
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/matches');
  });

  it('threads the night title + normalized stops off get_lock_night_detail', async () => {
    mockClient.current = buildClient({ userId: 'me', lock: lock(), night: night() }) as Record<string, unknown>;
    const ui = await call();
    render(ui);
    const detail = screen.getByTestId('lock-detail');
    expect(detail).toHaveAttribute('data-night-title', 'jazz bar + late night ramen');
    expect(detail).toHaveAttribute('data-stops', 'Rooftop Bar|Late-Night Ramen');
  });

  it('degrades to empty night data when the RPC returns nothing', async () => {
    mockClient.current = buildClient({ userId: 'me', lock: lock(), night: null }) as Record<string, unknown>;
    const ui = await call();
    render(ui);
    const detail = screen.getByTestId('lock-detail');
    expect(detail).toHaveAttribute('data-night-title', '');
    expect(detail).toHaveAttribute('data-stops', '');
  });

  it('falls back to the RPC time window when the instance embed is hidden', async () => {
    mockClient.current = buildClient({
      userId: 'me',
      lock: lock({ instance: null }),
      night: night(),
    }) as Record<string, unknown>;
    const ui = await call();
    render(ui);
    expect(screen.getByTestId('lock-detail')).toHaveAttribute('data-starts-at', '2999-01-01T19:00:00Z');
  });

  it('derives ratingOpen=false for a future night (no rate CTA pre-date)', async () => {
    mockClient.current = buildClient({ userId: 'me', lock: lock(), night: night() }) as Record<string, unknown>;
    const ui = await call();
    render(ui);
    expect(screen.getByTestId('lock-detail')).toHaveAttribute('data-rating-open', 'false');
  });

  it('derives ratingOpen=true once the night + grace window has passed', async () => {
    mockClient.current = buildClient({
      userId: 'me',
      lock: lock({
        status: 'completed',
        instance: {
          id: 'inst-2',
          starts_at: '2020-01-01T19:00:00Z',
          time_range: null,
        },
      }),
      night: night({ title: 'pottery night', stops: [], time_window_start: '2020-01-01T19:00:00Z' }),
    }) as Record<string, unknown>;
    const ui = await call();
    render(ui);
    expect(screen.getByTestId('lock-detail')).toHaveAttribute('data-rating-open', 'true');
  });

  it('keeps the tab shell on the not-your-match guard', async () => {
    mockClient.current = buildClient({ userId: 'someone-else', lock: lock() }) as Record<string, unknown>;
    const ui = await call();
    render(ui);
    expect(screen.getByText(/that's not your match/i)).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
  });
});
