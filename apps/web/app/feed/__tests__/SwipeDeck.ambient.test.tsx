import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const recordSwipe = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  recordSwipe: (...a: unknown[]) => recordSwipe(...a),
  saveFeedFilters: vi.fn().mockResolvedValue(undefined),
  getNightDetail: vi.fn().mockResolvedValue(null),
  ambientSoundUrl: (p: string | null) => (p ? `https://x/${p}` : null),
}));
// SwipeDeck now reads useRouter (refetch) + BottomTabShell reads usePathname.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/feed',
}));

const toggleMute = vi.fn();
let unmuted = false;
const useAmbientDeck = vi.fn(() => ({ unmuted, toggleMute }));
vi.mock('../useAmbientDeck', () => ({
  useAmbientDeck: (...a: unknown[]) => useAmbientDeck(...a),
}));

vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Root = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null;
  return { Drawer: { Root, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass } };
});

import { SwipeDeck } from '../SwipeDeck';

const base = (id: string, path: string | null = null) => ({
  date_instance_id: id, city_id: 'c',
  time_window_start: new Date(Date.now() + 86400000).toISOString(),
  itinerary_id: 'i', pay_setting: null, vibe_tags: [] as string[], why_note: 'w',
  cover_image_url: null, title: 'T', venue_neighborhood: null, is_seed: false,
  distance_m: 1000, ambient_sound_path: path, ambient_sound_name: path ? 'snd' : null,
});

beforeEach(() => {
  recordSwipe.mockClear();
  toggleMute.mockClear();
  useAmbientDeck.mockClear();
  unmuted = false;
});

describe('SwipeDeck ambient', () => {
  it('renders a persistent unmute pill reflecting the muted state', () => {
    render(<SwipeDeck initial={[base('a')]} />);
    const pill = screen.getByRole('button', { name: /unmute the soundtrack/i });
    expect(pill).toHaveAttribute('aria-pressed', 'false');
  });

  it('passes the resolved ambient URLs and active index to useAmbientDeck', () => {
    render(<SwipeDeck initial={[base('a', 'cozy/x.m4a'), base('b', null)]} />);
    expect(useAmbientDeck).toHaveBeenCalled();
    const [urls, index] = useAmbientDeck.mock.calls[0] as unknown as [(string | null)[], number];
    expect(urls).toEqual(['https://x/cozy/x.m4a', null]);
    expect(index).toBe(0);
  });

  it('clicking the pill calls toggleMute', async () => {
    render(<SwipeDeck initial={[base('a')]} />);
    await userEvent.click(screen.getByRole('button', { name: /unmute the soundtrack/i }));
    expect(toggleMute).toHaveBeenCalledTimes(1);
  });

  it('reflects aria-pressed=true when unmuted', () => {
    unmuted = true;
    render(<SwipeDeck initial={[base('a')]} />);
    const pill = screen.getByRole('button', { name: /mute the soundtrack/i });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
  });
});
