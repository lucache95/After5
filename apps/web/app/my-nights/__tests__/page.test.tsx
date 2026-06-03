// apps/web/app/my-nights/__tests__/page.test.tsx
// Tests for the host-facing nights list page (/my-nights).
// Mocking pattern mirrors apps/web/app/dates/[slug]/interested/__tests__/page.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { redirect, mockClient } = vi.hoisted(() => {
  const redirect = vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); });
  const mockClient = { current: undefined as Record<string, unknown> | undefined };
  return { redirect, mockClient };
});

vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }));
vi.mock('@/components/BottomTabShell', () => ({ BottomTabShell: () => <nav data-testid="bottom-nav" /> }));
// The header bell was retired (#84); the page now mounts the headless toast. Mock
// it so the page's transitive useRouter import doesn't need the navigation mock.
vi.mock('@/components/NotificationToast', () => ({ NotificationToast: () => null }));
vi.mock('@/components/Polaroid', () => ({
  Polaroid: ({ alt }: { alt: string }) => <div data-testid="polaroid" aria-label={alt} />,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));

import Page from '../page';

function buildClient(opts: {
  userId: string | null;
  nights?: Array<{ id: string; starts_at: string; status: string; itinerary: { title: string | null; cover_image_url: string | null } | null }>;
}) {
  const nights = opts.nights ?? [];

  return {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    from: (_table: string) => ({
      select: () => ({
        order: () => ({
          limit: async () => ({ data: nights }),
        }),
      }),
    }),
  };
}

beforeEach(() => { redirect.mockClear(); });

describe('MyNightsPage', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(Page()).rejects.toThrow(/REDIRECT:\/login\?next=\/my-nights/);
  });

  it('renders empty state with CTA when no nights posted', async () => {
    mockClient.current = buildClient({ userId: 'host-1', nights: [] }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByText('no nights yet')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /post a night/i });
    expect(cta).toHaveAttribute('href', '/nights/new');
  });

  it('renders a card per night linking to the interested list', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [
        { id: 'inst-1', starts_at: '2026-06-10T19:00:00Z', status: 'seeking', itinerary: { title: 'golden hour walk', cover_image_url: null } },
        { id: 'inst-2', starts_at: '2026-06-12T20:00:00Z', status: 'matched', itinerary: { title: 'rooftop wine', cover_image_url: null } },
      ],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    expect(screen.getByText('golden hour walk')).toBeInTheDocument();
    expect(screen.getByText('rooftop wine')).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    const interestedLinks = links.filter((l) => l.getAttribute('href')?.includes('/interested'));
    expect(interestedLinks).toHaveLength(2);
    expect(interestedLinks[0]).toHaveAttribute('href', '/dates/inst-1/interested');
    expect(interestedLinks[1]).toHaveAttribute('href', '/dates/inst-2/interested');
  });

  it('shows open status pill for seeking nights', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [
        { id: 'inst-1', starts_at: '2026-06-10T19:00:00Z', status: 'seeking', itinerary: { title: 'a plan', cover_image_url: null } },
      ],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('shows matched status pill for matched nights', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [
        { id: 'inst-1', starts_at: '2026-06-10T19:00:00Z', status: 'matched', itinerary: { title: 'a plan', cover_image_url: null } },
      ],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByText('matched')).toBeInTheDocument();
  });
});
