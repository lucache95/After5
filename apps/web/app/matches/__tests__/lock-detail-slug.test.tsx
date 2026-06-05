import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// LockDetail is a client component with heavy dependencies (vaul drawer, sonner,
// next/navigation, RevealModal). Stub the bits that don't matter for the slug-link
// assertion so the test stays focused on the E21 / D-01 contract:
//   post-lock, a stop WITH a catalog slug links its name to /places/[slug];
//   a stop WITHOUT a slug renders plain text (graceful degrade) — never a broken link.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('../[lockId]/RevealModal', () => ({ RevealModal: () => null }));
vi.mock('../[lockId]/MatchConfirmation', () => ({ MatchConfirmation: () => null }));

import { LockDetail } from '../[lockId]/LockDetail';
import type { NightDetailStop } from '@/lib/after5/client';
import type { PartyProfile } from '../lock-view';

function stop(over: Partial<NightDetailStop>): NightDetailStop {
  return {
    name: 'a spot', type: null, start_time: null, duration_min: null,
    cost_pp: null, what_to_do: null, neighborhood: null, local_insight: null,
    photo_url: null, lat: null, lng: null, place_slug: null, drive_to_next_min: null,
    ...over,
  };
}

const counterpart = {
  id: 'u1', first_name: 'sam', age: 28, city: 'kelowna', neighborhood: null,
  clear_photo_url: null, vibe_tags: null, prompt_answers: null, pronouns: null,
  verification: null, reliability_score: null,
} as unknown as PartyProfile;

function renderLock(stops: NightDetailStop[]) {
  return render(
    <LockDetail
      lockId="lock-1"
      status="active"
      counterpart={counterpart}
      threadId={null}
      startsAt={null}
      ratingOpen={false}
      justLocked={false}
      stops={stops}
      vibeTags={null}
    />,
  );
}

describe('LockDetail venue links (E21 / D-01, post-match)', () => {
  it('links a stop name to /places/[slug] when the stop has a catalog slug', () => {
    renderLock([stop({ name: 'jazz cellar', place_slug: 'jazz-cellar' })]);
    const nameLink = screen.getByRole('link', { name: 'jazz cellar' });
    expect(nameLink).toHaveAttribute('href', '/places/jazz-cellar');
  });

  it('renders a slugless stop name as plain text — no broken /places link (graceful degrade)', () => {
    const { container } = renderLock([stop({ name: 'mystery spot', place_slug: null })]);
    expect(container.querySelector('a[href^="/places/"]')).toBeNull();
    expect(screen.getByText('mystery spot').closest('a')).toBeNull();
  });

  it('links only the slug-bearing stops in a mixed plan', () => {
    const { container } = renderLock([
      stop({ name: 'jazz cellar', place_slug: 'jazz-cellar' }),
      stop({ name: 'mystery spot', place_slug: null }),
    ]);
    expect(screen.getByRole('link', { name: 'jazz cellar' })).toHaveAttribute('href', '/places/jazz-cellar');
    expect(screen.getByText('mystery spot').closest('a')).toBeNull();
    expect(container.querySelectorAll('a[href^="/places/"]').length).toBe(1);
  });
});
