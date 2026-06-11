import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { NightDetailNight, NightDetailStop } from '@after5/api-client';

// get_night_detail is mocked per-test so we can drive the pending (skeleton) vs
// resolved (real content) branches deterministically.
const getNightDetail = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  getNightDetail: (...a: unknown[]) => getNightDetail(...a),
}));
// vaul reads real CSS transform matrices jsdom doesn't compute; stub the Drawer
// primitives to plain DOM. The blind contract + skeleton under test live in our
// own component, not vaul.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Root = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null;
  return { Drawer: { Root, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass } };
});

import { NightDetailSheet } from '../NightDetailSheet';

const feedNight = {
  date_instance_id: 'di-1',
  city_id: 'c',
  time_window_start: new Date(Date.now() + 86400000).toISOString(),
  itinerary_id: 'i',
  pay_setting: null,
  vibe_tags: ['creative'],
  why_note: 'low-key, hands dirty',
  cover_image_url: null,
  title: 'Pottery + ramen',
  venue_neighborhood: 'Downtown',
  is_seed: false,
  distance_m: 1000,
  ambient_sound_path: null,
  ambient_sound_name: null,
  city_name: 'kelowna',
  host_first_name: null,
  host_age: null,
  host_blurred_photo_url: null,
} as never;

function stop(over: Partial<NightDetailStop> = {}): NightDetailStop {
  return {
    name: 'a spot', type: null, start_time: null, duration_min: null, cost_pp: null,
    what_to_do: null, neighborhood: null, local_insight: null, photo_url: null,
    lat: null, lng: null, place_slug: null, google_place_id: null, drive_to_next_min: null, ...over,
  };
}

function detail(over: Partial<NightDetailNight> = {}): NightDetailNight {
  return {
    date_instance_id: 'di-1',
    time_window_start: new Date(Date.now() + 86400000).toISOString(),
    pay_setting: null, vibe_tags: ['creative'], why_note: 'low-key', hook: 'the hook',
    why_it_works: null, cover_image_url: null, title: 'Pottery + ramen',
    venue_neighborhood: 'Downtown', is_seed: false, total_cost_pp: 40, total_duration_min: 120,
    stops: [stop()], ...over,
  };
}

const noop = () => {};

beforeEach(() => {
  getNightDetail.mockReset();
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = 'pk.test';
});

describe('NightDetailSheet', () => {
  it('skeleton: shows a silent shimmer while detail is null and the sheet is open', async () => {
    // never resolves → the sheet stays in the pending state.
    getNightDetail.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <NightDetailSheet night={feedNight} open busy={false} onOpenChange={noop} onCommit={noop} />,
    );
    // reduced-motion-friendly shimmer atoms are present...
    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse.motion-reduce\\:animate-none').length)
        .toBeGreaterThan(0),
    );
    // ...and no spinner / loading caption text (silent skeleton, UI-SPEC E25).
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('resolve: real detail replaces the skeleton once get_night_detail resolves', async () => {
    getNightDetail.mockResolvedValue(detail({ stops: [stop({ name: 'pottery studio' })] }));
    const { container } = render(
      <NightDetailSheet night={feedNight} open busy={false} onOpenChange={noop} onCommit={noop} />,
    );
    // the real timeline section renders (exact eyebrow, not the reassurance copy).
    expect(await screen.findByText('the night')).toBeInTheDocument();
    // the pending shimmer card is gone.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="detail-skeleton"]')).toBeNull(),
    );
  });

  it('map: renders the RouteMap when >=1 stop has coords', async () => {
    getNightDetail.mockResolvedValue(
      detail({ stops: [stop({ name: 'a', lat: 49.88, lng: -119.49 }), stop({ name: 'b', lat: 49.89, lng: -119.5 })] }),
    );
    render(<NightDetailSheet night={feedNight} open busy={false} onOpenChange={noop} onCommit={noop} />);
    // the route section eyebrow + the expandable static map button.
    expect(await screen.findByText('the route')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /expand the route map/i })).toBeInTheDocument();
  });

  it('map fallback: 0 coords → the "short hop apart" placeholder, never a broken map', async () => {
    getNightDetail.mockResolvedValue(detail({ stops: [stop({ name: 'a' }), stop({ name: 'b' })] }));
    render(<NightDetailSheet night={feedNight} open busy={false} onOpenChange={noop} onCommit={noop} />);
    expect(await screen.findByText(/a short hop apart/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand the route map/i })).not.toBeInTheDocument();
  });

  it('preloaded: renders the full detail immediately with ZERO get_night_detail calls', () => {
    render(
      <NightDetailSheet
        night={feedNight}
        open
        onOpenChange={noop}
        preloaded={detail({ stops: [stop({ name: 'pottery studio' })] })}
      />,
    );
    // the real timeline + the preloaded stop are there at first paint...
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText('pottery studio')).toBeInTheDocument();
    // ...no skeleton hold (settled immediately)...
    expect(screen.queryByTestId('detail-skeleton')).not.toBeInTheDocument();
    // ...and the pre-lock RPC is never touched (it would return empty for a lock).
    expect(getNightDetail).not.toHaveBeenCalled();
  });

  it('preloaded + linkSlugs: the post-lock caller gets the /places slug link', () => {
    const { container } = render(
      <NightDetailSheet
        night={feedNight}
        open
        onOpenChange={noop}
        linkSlugs
        preloaded={detail({ stops: [stop({ name: 'pottery studio', place_slug: 'pottery-studio' })] })}
      />,
    );
    const placeLinks = Array.from(container.querySelectorAll('a[href]')).filter((a) =>
      (a.getAttribute('href') ?? '').includes('/places/pottery-studio'),
    );
    expect(placeLinks).toHaveLength(1);
    expect(getNightDetail).not.toHaveBeenCalled();
  });

  it('blind contract: the sheet never renders a /places slug link', async () => {
    getNightDetail.mockResolvedValue(
      detail({ stops: [stop({ name: 'pottery studio', place_slug: 'pottery-studio', lat: 49.88, lng: -119.49 })] }),
    );
    const { container } = render(
      <NightDetailSheet night={feedNight} open busy={false} onOpenChange={noop} onCommit={noop} />,
    );
    await screen.findByText('the night');
    const placeLinks = Array.from(container.querySelectorAll('a[href]')).filter((a) =>
      (a.getAttribute('href') ?? '').includes('/places/'),
    );
    expect(placeLinks).toHaveLength(0);
  });
});
