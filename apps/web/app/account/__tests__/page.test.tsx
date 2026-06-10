// apps/web/app/account/__tests__/page.test.tsx
// REQ-E3: the /account hub is an identity-forward profile home. These tests assert
// the enhanced surface renders identity (name/age/city + a verification chip), a
// self-view trigger, the three secondary links (edit/preferences/notifications),
// keeps the existing working links (loop + post-a-night + sign-out),
// and renders NO marketing/onboarding teaser copy.
// Supabase-mock pattern mirrors apps/web/app/my-nights/__tests__/page.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { redirect, mockClient } = vi.hoisted(() => {
  const redirect = vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); });
  const mockClient = { current: undefined as Record<string, unknown> | undefined };
  return { redirect, mockClient };
});

vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }));
vi.mock('@/components/BottomTabShell', () => ({ BottomTabShell: () => <nav data-testid="bottom-nav" /> }));
vi.mock('@/components/NotificationToast', () => ({ NotificationToast: () => null }));
// SelfViewTrigger pulls in vaul + ProfileCard (next/image, client state). Stub it
// to a button so the server-component page test stays focused on the hub markup;
// the trigger's own behavior is covered by its client boundary + SelfViewSheet.
vi.mock('@/components/SelfViewTrigger', () => ({
  SelfViewTrigger: () => <button type="button">preview my profile</button>,
}));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
// Owner photo gallery + signing — irrelevant to the markup assertions here.
vi.mock('@/lib/after5/photos', () => ({
  listMyPhotos: async () => [],
  signClearUrls: async () => [],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));

import Page from '../page';

interface ProfileFixture {
  first_name?: string | null;
  age?: number | null;
  city?: string | null;
  neighborhood?: string | null;
  verification?: string | null;
  clear_photo_url?: string | null;
  vibe_tags?: string[] | null;
  prompt_answers?: { prompt_id: string; answer: string }[] | null;
  pronouns?: string | null;
  height_cm?: number | null;
  occupation?: string | null;
}

function buildClient(opts: {
  userId: string | null;
  email?: string;
  profile?: ProfileFixture | null;
  bio?: string | null;
  promptDefs?: { id: string; label: string }[];
}) {
  const profile = opts.profile === undefined ? {} : opts.profile;
  const priv = opts.bio === undefined ? null : { bio: opts.bio };
  const promptDefs = opts.promptDefs ?? [];

  return {
    auth: {
      getUser: async () => ({
        data: { user: opts.userId ? { id: opts.userId, email: opts.email ?? 'q@a.co' } : null },
      }),
    },
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: null }) }),
    },
    from: (table: string) => {
      if (table === 'profile_prompts') {
        return {
          select: () => ({
            in: async () => ({ data: promptDefs }),
          }),
        };
      }
      // profiles / profiles_private — both end at .maybeSingle().
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === 'profiles_private' ? priv : profile,
            }),
          }),
        }),
      };
    },
  };
}

beforeEach(() => { redirect.mockClear(); });

describe('AccountPage (profile hub — REQ-E3)', () => {
  it('redirects to login when signed out', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(Page()).rejects.toThrow(/REDIRECT:\/login\?next=\/account/);
  });

  it('renders identity (name, age, city) and a verification chip', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: { first_name: 'Avery', age: 29, city: 'Vancouver', verification: 'verified' },
      bio: 'i make playlists for strangers.',
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    expect(screen.getByRole('heading', { name: 'hey avery' })).toBeInTheDocument();
    expect(screen.getByText('avery, 29')).toBeInTheDocument();
    // city renders as stored text; the `lowercase` class is visual-only.
    expect(screen.getByText('Vancouver')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
  });

  it('shows an unverified chip linking to the verify flow when not verified', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: { first_name: 'Sam', age: 31, city: 'Toronto', verification: 'unverified' },
      bio: 'hi',
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    const chip = screen.getByRole('link', { name: /unverified/i });
    expect(chip).toHaveAttribute('href', '/onboarding/verify');
  });

  it('renders a self-view trigger ("as others see it")', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: { first_name: 'Avery', age: 29, city: 'Vancouver', verification: 'verified' },
      bio: 'hi',
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByRole('button', { name: /preview my profile/i })).toBeInTheDocument();
  });

  it('renders the three secondary links (edit profile / preferences / notifications)', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: { first_name: 'Avery', age: 29, city: 'Vancouver', verification: 'verified' },
      bio: 'hi',
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/account/profile');
    expect(hrefs).toContain('/account/preferences');
    expect(hrefs).toContain('/account/notifications');
  });

  it('renders the dating-profile summary (bio + prompt) when present', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: {
        first_name: 'Avery', age: 29, city: 'Vancouver', verification: 'verified',
        vibe_tags: ['cozy', 'night owl'],
        prompt_answers: [{ prompt_id: 'p1', answer: 'tacos at midnight' }],
      },
      bio: 'i make playlists for strangers.',
      promptDefs: [{ id: 'p1', label: 'my perfect night' }],
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    expect(screen.getByText('i make playlists for strangers.')).toBeInTheDocument();
    expect(screen.getByText('my perfect night')).toBeInTheDocument();
    expect(screen.getByText('tacos at midnight')).toBeInTheDocument();
    expect(screen.getByText('cozy')).toBeInTheDocument();
  });

  it('shows the authored empty-state when the profile is bare', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: { first_name: 'Avery', age: 29, city: 'Vancouver', verification: 'verified' },
      bio: null,
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByText("your profile's a little bare")).toBeInTheDocument();
  });

  it('keeps the existing working links (loop, post-a-night, edit, sign-out)', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: { first_name: 'Avery', age: 29, city: 'Vancouver', verification: 'verified' },
      bio: 'hi',
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/feed');
    expect(hrefs).toContain('/matches');
    expect(hrefs).toContain('/my-nights');
    expect(hrefs).toContain('/nights/new'); // post a night
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('renders NO marketing / onboarding teaser copy', async () => {
    mockClient.current = buildClient({
      userId: 'u-1',
      profile: { first_name: 'Avery', age: 29, city: 'Vancouver', verification: 'verified' },
      bio: 'hi',
    }) as Record<string, unknown>;
    const ui = await Page();
    const { container } = render(ui);
    const text = container.textContent ?? '';

    for (const banned of [/welcome/i, /get started/i, /how it works/i, /sign up free/i, /try after5/i, /enable dating/i]) {
      expect(text).not.toMatch(banned);
    }
  });
});
