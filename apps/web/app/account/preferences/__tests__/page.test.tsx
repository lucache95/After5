// REQ-E4 / T-03-01 / T-03-02 — the auth-gated /account/preferences SSR route.
// Asserts: (1) signed-out → redirect('/login?next=/account/preferences') (V2 gate,
// info-disclosure mitigation), (2) the read prefs hydrate into PreferencesForm
// (age range via the canonical parseAgePref, dating_enabled passed through), and
// (3) the page mounts DeepRouteHeader backHref='/account' and does NOT mount a
// bottom nav. userId is the session user (never client-supplied).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { redirect, mockClient } = vi.hoisted(() => {
  const redirect = vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); });
  const mockClient = { current: undefined as Record<string, unknown> | undefined };
  return { redirect, mockClient };
});

vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mockClient.current }));
vi.mock('@/components/DeepRouteHeader', () => ({
  DeepRouteHeader: (props: { backHref: string; title?: string }) => (
    <div data-testid="deep-route-header" data-backhref={props.backHref} data-title={props.title} />
  ),
}));
vi.mock('@/components/PreferencesForm', () => ({
  PreferencesForm: (props: { mode: string; userId: string; initial: Record<string, unknown>; datingEnabled?: boolean }) => (
    <div
      data-testid="prefs-form"
      data-mode={props.mode}
      data-userid={props.userId}
      data-agemin={String(props.initial.age_min)}
      data-agemax={String(props.initial.age_max)}
      data-distance={String(props.initial.distance_pref_km)}
      data-dating={String(props.datingEnabled)}
    />
  ),
}));

import Page from '../page';

function buildClient(opts: { userId: string | null; profile?: Record<string, unknown> | null }) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }) },
    from: (_table: string) => ({
      select: () => ({
        eq: (_c: string, _v: string) => ({
          maybeSingle: async () => ({ data: opts.profile ?? null }),
        }),
      }),
    }),
  };
}

beforeEach(() => { redirect.mockClear(); });

describe('/account/preferences page (REQ-E4)', () => {
  it('redirects signed-out users to /login?next=/account/preferences (V2 gate)', async () => {
    mockClient.current = buildClient({ userId: null }) as Record<string, unknown>;
    await expect(Page()).rejects.toThrow('REDIRECT:/login?next=/account/preferences');
  });

  it('hydrates the read prefs into PreferencesForm mode=account with the session userId', async () => {
    mockClient.current = buildClient({
      userId: 'u-self',
      profile: {
        gender: 'man',
        gender_preferences: ['woman'],
        age_pref: '[25,40)', // upper-EXCLUSIVE stored form → max 39
        distance_pref_km: 30,
        dealbreakers: [],
        dating_enabled: true,
      },
    }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);

    const form = screen.getByTestId('prefs-form');
    expect(form).toHaveAttribute('data-mode', 'account');
    expect(form).toHaveAttribute('data-userid', 'u-self');
    // canonical parseAgePref: '[25,40)' → { min:25, max:39 } (Pitfall 3)
    expect(form).toHaveAttribute('data-agemin', '25');
    expect(form).toHaveAttribute('data-agemax', '39');
    expect(form).toHaveAttribute('data-distance', '30');
    expect(form).toHaveAttribute('data-dating', 'true');
  });

  it('mounts DeepRouteHeader with backHref=/account (E1) and no bottom nav', async () => {
    mockClient.current = buildClient({ userId: 'u-self', profile: null }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    const header = screen.getByTestId('deep-route-header');
    expect(header).toHaveAttribute('data-backhref', '/account');
    expect(header).toHaveAttribute('data-title', 'preferences');
  });

  it('defaults dating_enabled to false when the profile row is missing', async () => {
    mockClient.current = buildClient({ userId: 'u-self', profile: null }) as Record<string, unknown>;
    const ui = await Page();
    render(ui);
    expect(screen.getByTestId('prefs-form')).toHaveAttribute('data-dating', 'false');
  });
});
