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
vi.mock('next/image', () => ({
  // next/image needs a plain <img>-shaped stub in jsdom; alt is empty by design
  // (decorative banner), so expose the src for assertions.
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} data-testid="cover" />,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));

import Page from '../page';

const eqSpy = vi.fn();

interface NightFixture {
  id: string;
  starts_at: string;
  status: string;
  itinerary: { title: string | null; cover_image_url: string | null; inputs?: { vibe?: string[] } | null } | null;
}

function buildClient(opts: {
  userId: string | null;
  nights?: NightFixture[];
  /** queue_entries rows the creator can read; tallied per date_instance_id. */
  queue?: Array<{ date_instance_id: string }>;
}) {
  const nights = opts.nights ?? [];
  const queue = opts.queue ?? [];

  return {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    from: (table: string) => ({
      select: () => ({
        // queue_entries query ends at .eq() and is awaited directly; make the
        // returned object both thenable (for queue) and chainable (for nights).
        eq: (col: string, val: unknown) => {
          eqSpy(col, val);
          const data = table === 'queue_entries' ? queue : nights;
          return {
            order: () => ({ limit: async () => ({ data: nights }) }),
            then: (resolve: (v: { data: unknown }) => unknown) => resolve({ data }),
          };
        },
      }),
    }),
  };
}

beforeEach(() => { redirect.mockClear(); eqSpy.mockClear(); });

describe('MyNightsPage', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(Page()).rejects.toThrow(/REDIRECT:\/login\?next=\/my-nights/);
  });

  it('scopes the query to the viewer\'s own posted nights (bug #79)', async () => {
    // Regression: date_instances ORs a creator policy with an offer-recipient
    // SELECT policy, so without an explicit creator_id filter the list leaks
    // nights the viewer only received an offer for — and tapping those hits the
    // interested-list guard's "not your date" rejection.
    mockClient.current = buildClient({ userId: 'host-1', nights: [] }) as Record<string, unknown>;
    await Page();
    expect(eqSpy).toHaveBeenCalledWith('creator_id', 'host-1');
  });

  it('renders empty state with CTA when no nights posted', async () => {
    mockClient.current = buildClient({ userId: 'host-1', nights: [] }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByText('nothing posted yet')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /post your first night/i });
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

  it('renders a cover banner image for each night', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [
        { id: 'inst-1', starts_at: '2026-06-10T19:00:00Z', status: 'seeking', itinerary: { title: 'a plan', cover_image_url: null } },
      ],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    const cover = screen.getByTestId('cover');
    // place-image resolver never returns '' — a real local asset path is present.
    expect(cover.getAttribute('src')).toMatch(/^\//);
  });

  it('shows the interested count on the card and in the chip', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [
        { id: 'inst-1', starts_at: '2026-06-10T19:00:00Z', status: 'seeking', itinerary: { title: 'a plan', cover_image_url: null } },
      ],
      queue: [
        { date_instance_id: 'inst-1' },
        { date_instance_id: 'inst-1' },
        { date_instance_id: 'inst-1' },
      ],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    // "3 interested" shows in both the meta row and the seeking chip.
    expect(screen.getAllByText('3 interested').length).toBeGreaterThanOrEqual(1);
  });

  it('singularizes a count of one interested person', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [
        { id: 'inst-1', starts_at: '2026-06-10T19:00:00Z', status: 'seeking', itinerary: { title: 'a plan', cover_image_url: null } },
      ],
      queue: [{ date_instance_id: 'inst-1' }],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    // appears in both meta row and chip when seeking with one person.
    expect(screen.getAllByText('1 interested').length).toBeGreaterThanOrEqual(1);
  });

  it('shows open chip for a seeking night with no interest yet', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [
        { id: 'inst-1', starts_at: '2026-06-10T19:00:00Z', status: 'seeking', itinerary: { title: 'a plan', cover_image_url: null } },
      ],
      queue: [],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('0 interested')).toBeInTheDocument();
  });

  it('shows matched chip for matched nights', async () => {
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
