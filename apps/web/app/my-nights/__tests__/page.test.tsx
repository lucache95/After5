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

// SC3: seeking-night cards now mount NightCardActions (a client leaf) which reads
// useRouter for its cancel/edit refresh, so the page's transitive tree needs it.
vi.mock('next/navigation', () => ({
  redirect: (p: string) => redirect(p),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
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
// SC3: the page also loads the ambient-sound library (and a live-venue list) when a
// seeking night exists, to feed the host's edit pickers. Stub the api-client call so
// the page renders; the venue list is handled by the `places` branch in buildClient.
vi.mock('@after5/api-client', () => ({ listAmbientSounds: async () => [] }));

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
  /** viewer-owned itineraries (draft candidates). */
  drafts?: Array<Record<string, unknown>>;
  /** date_instances rows linking itinerary ids that HAVE been posted. */
  posted?: Array<{ itinerary_id: string }>;
}) {
  const nights = opts.nights ?? [];
  const queue = opts.queue ?? [];
  const drafts = opts.drafts ?? [];
  const posted = opts.posted ?? [];

  return {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    from: (table: string) => ({
      select: () => ({
        // queue_entries query ends at .eq() and is awaited directly; make the
        // returned object both thenable (for queue) and chainable (for nights).
        // SC3: the `places` venue-options query chains a second .eq() then
        // .order().limit() and resolves to {data:[]} — no venues needed in tests.
        eq: (col: string, val: unknown) => {
          eqSpy(col, val);
          // route by table: queue_entries is awaited directly; itineraries is
          // the drafts-candidates query (.order().limit()); date_instances is
          // the nights query (.order().limit()).
          const data = table === 'queue_entries' ? queue : table === 'itineraries' ? drafts : nights;
          return {
            eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
            order: () => ({ limit: async () => ({ data }) }),
            then: (resolve: (v: { data: unknown }) => unknown) => resolve({ data }),
          };
        },
        // drafts exclusion lookup: date_instances .select('itinerary_id').in(...)
        in: async () => ({ data: posted }),
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

  it('renders the quiet drafts section with title, meta, and edit link', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [],
      drafts: [
        { id: 'plan-1', title: 'patio crawl', cover_image_url: null, stops: [{}, {}, {}], total_cost_pp: 45, total_duration_min: 150 },
        { id: 'plan-2', title: null, cover_image_url: null, stops: null, total_cost_pp: null, total_duration_min: null },
      ],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    expect(screen.getByText('drafts')).toBeInTheDocument();
    expect(screen.getByText('patio crawl')).toBeInTheDocument();
    expect(screen.getByText('3 stops · ~2.5 hr · $45 pp')).toBeInTheDocument();
    // a title-less draft falls back to the quiet placeholder name
    expect(screen.getByText('untitled night')).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/plans/plan-1/edit')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/plans/plan-2/edit')).toBe(true);
  });

  it('excludes itineraries that already have a posted date_instance', async () => {
    mockClient.current = buildClient({
      userId: 'host-1',
      nights: [],
      drafts: [
        { id: 'plan-1', title: 'already posted', cover_image_url: null, stops: [], total_cost_pp: null, total_duration_min: null },
        { id: 'plan-2', title: 'still a draft', cover_image_url: null, stops: [], total_cost_pp: null, total_duration_min: null },
      ],
      posted: [{ itinerary_id: 'plan-1' }],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    expect(screen.getByText('still a draft')).toBeInTheDocument();
    expect(screen.queryByText('already posted')).not.toBeInTheDocument();
  });

  it('renders no drafts section when there are no drafts', async () => {
    mockClient.current = buildClient({ userId: 'host-1', nights: [] }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.queryByText('drafts')).not.toBeInTheDocument();
    // posted-nights empty state still intact alongside the absent drafts section
    expect(screen.getByText('nothing posted yet')).toBeInTheDocument();
  });
});
