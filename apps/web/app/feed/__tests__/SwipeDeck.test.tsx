import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const recordSwipe = vi.fn().mockResolvedValue(undefined);
const saveFeedFilters = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  recordSwipe: (...a: unknown[]) => recordSwipe(...a),
  // E10: the FilterSheet + empty-state loosen self-write feed_filters.
  saveFeedFilters: (...a: unknown[]) => saveFeedFilters(...a),
  // NightDetailSheet (rendered by SwipeDeck) now fetches get_night_detail on open.
  // Return null so the sheet shows the blind-summary fallback these tests assert.
  getNightDetail: vi.fn().mockResolvedValue(null),
  // M4: SwipeDeck resolves each card's ambient path to a public URL.
  ambientSoundUrl: (p: string | null) => (p ? `https://x/${p}` : null),
}));
// SwipeDeck refetches the feed via router.refresh() after an apply/loosen, and
// (F1) the teaser-mode verify CTA pushes /onboarding. usePathname is also
// exported here because BottomTabShell (rendered inside the empty states) reads it.
const routerRefresh = vi.fn();
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh, push: routerPush }),
  usePathname: () => '/feed',
}));
// F1 teaser mode raises a sonner toast with a verify CTA; capture it so the tests
// can assert the prompt fired (and follow its action into /onboarding).
const toastFn = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: Object.assign((...a: unknown[]) => toastFn(...a), {
    error: (...a: unknown[]) => toastError(...a),
  }),
}));
// vaul's pointer-drag dismissal reads real CSS transform matrices that jsdom
// doesn't compute, so we stub the Drawer primitives to plain DOM. The blind
// contract + swipe wiring under test live in our own component, not vaul.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Root = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null;
  return { Drawer: { Root, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass } };
});
import { SwipeDeck } from '../SwipeDeck';
const night = (id: string, over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(id), ...over });
const base = (id: string) => ({ date_instance_id: id, city_id: 'c', time_window_start: new Date(Date.now()+86400000).toISOString(), itinerary_id: 'i', pay_setting: null, vibe_tags: [] as string[], why_note: 'w', cover_image_url: null, title: 'T', venue_neighborhood: null, is_seed: false, distance_m: 1000, ambient_sound_path: null as string | null, ambient_sound_name: null as string | null });

beforeEach(() => {
  recordSwipe.mockClear();
  saveFeedFilters.mockReset().mockResolvedValue(undefined);
  routerRefresh.mockClear();
  routerPush.mockClear();
  toastFn.mockClear();
  toastError.mockClear();
});

describe('SwipeDeck', () => {
  it('empty: shows the dry end-of-deck copy when no nights', () => {
    render(<SwipeDeck initial={[]} />);
    expect(screen.getByText(/that.s everyone for now/i)).toBeInTheDocument();
    expect(screen.getByText(/touch grass/i)).toBeInTheDocument();
  });
  it('swipe right records and advances to the next card', async () => {
    render(<SwipeDeck initial={[night('a'), night('b')]} />);
    await userEvent.click(screen.getAllByRole('button', { name: /interested/i })[0]);
    await waitFor(() => expect(recordSwipe).toHaveBeenCalledWith(expect.anything(), 'a', 'right'));
  });

  it('pre-swipe detail: tapping the active card opens the full plan sheet', async () => {
    render(<SwipeDeck initial={[night('a', { title: 'Pottery + ramen', why_note: 'low-key, hands dirty', vibe_tags: ['creative', 'foodie'], venue_neighborhood: 'Downtown' })]} />);
    // The active card is a role=button with a "tap to read" affordance.
    const card = screen.getByRole('button', { name: /tap to read the full plan/i });
    fireEvent.keyDown(card, { key: 'Enter' });
    // The sheet renders the rich detail: the why + a labelled plan section.
    // (why_note also shows on the card behind it, so it appears more than once.)
    expect(await screen.findByText(/the why/i)).toBeInTheDocument();
    expect(screen.getAllByText(/low-key, hands dirty/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/the vibe/i)).toBeInTheDocument();
  });

  it('blind-safety: the detail sheet reveals no host identity and reassures it stays hidden', async () => {
    render(<SwipeDeck initial={[night('a', { title: 'Speakeasy + jazz', venue_neighborhood: 'Pandosy' })]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /tap to read the full plan/i }), { key: 'Enter' });
    // Reassurance copy is present (reveal-ladder: name+blurred now, clear face on match)...
    expect(await screen.findByText(/swiping on the night, not the face/i)).toBeInTheDocument();
    // ...and neighborhood is shown but NOT a precise address or a person name.
    expect(screen.getAllByText(/pandosy/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/hosted by|with sandrine|@/i)).not.toBeInTheDocument();
  });

  it('blind-safety: swiping from inside the detail sheet records and closes it', async () => {
    render(<SwipeDeck initial={[night('a'), night('b')]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /tap to read the full plan/i }), { key: 'Enter' });
    const sheetButtons = await screen.findAllByRole('button', { name: /interested/i });
    // The sheet adds a second "interested" button; clicking it records the swipe.
    await userEvent.click(sheetButtons[sheetButtons.length - 1]);
    await waitFor(() => expect(recordSwipe).toHaveBeenCalledWith(expect.anything(), 'a', 'right'));
  });
});

describe('SwipeDeck — E10 quick chips + recovery empty state', () => {
  it('renders the 3 quick chips inactive for a brand-new (unfiltered) searcher', () => {
    render(<SwipeDeck initial={[night('a')]} userId="u1" filters={{}} />);
    const chips = screen.getByRole('group', { name: /quick filters/i });
    expect(chips).toBeInTheDocument();
    // inactive chips show the bare label, no " · value"
    expect(screen.getByRole('button', { name: /^distance\. tap to open filters$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^price\. tap to open filters$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^vibe\. tap to open filters$/i })).toBeInTheDocument();
  });

  it('an active chip shows its value (e.g. ≤ 25km)', () => {
    render(<SwipeDeck initial={[night('a')]} userId="u1" filters={{ max_distance_km: 25 }} />);
    expect(screen.getByText(/distance · ≤ 25km/i)).toBeInTheDocument();
  });

  it('tapping a quick chip opens the FilterSheet', async () => {
    render(<SwipeDeck initial={[night('a')]} userId="u1" filters={{}} />);
    await userEvent.click(screen.getByRole('button', { name: /^distance\. tap to open filters$/i }));
    // the sheet title becomes visible (vaul stub renders content when open)
    expect(await screen.findByText('dealbreakers')).toBeInTheDocument();
  });

  it('empty + hard filter → filtered-recovery (names the filter, offers a widen)', () => {
    render(<SwipeDeck initial={[]} userId="u1" filters={{ max_distance_km: 10 }} />);
    expect(screen.getByText(/nothing fits those filters/i)).toBeInTheDocument();
    expect(screen.getByText(/your distance is set to 10km/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /widen to 50km/i })).toBeInTheDocument();
    // NOT the genuinely-empty copy
    expect(screen.queryByText(/that.s everyone for now/i)).not.toBeInTheDocument();
  });

  it('the widen action self-writes the loosened filters and refetches', async () => {
    render(<SwipeDeck initial={[]} userId="u1" filters={{ max_distance_km: 10 }} />);
    await userEvent.click(screen.getByRole('button', { name: /widen to 50km/i }));
    await waitFor(() =>
      expect(saveFeedFilters).toHaveBeenCalledWith(expect.anything(), 'u1', { max_distance_km: 50 }),
    );
    expect(routerRefresh).toHaveBeenCalled();
  });

  it('empty + NO hard filter → the genuinely-empty copy is unchanged', () => {
    render(<SwipeDeck initial={[]} userId="u1" filters={{ vibes: ['chill'] }} />);
    expect(screen.getByText(/that.s everyone for now/i)).toBeInTheDocument();
    expect(screen.getByText(/touch grass/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing fits those filters/i)).not.toBeInTheDocument();
  });
});

// F1 (launch): a signed-in pre-verification viewer browses read-only. The gate
// moved off the page (no redirect) onto the ACTION: interest → verify prompt.
describe('SwipeDeck — teaser mode for pre-verification viewers (launch F1)', () => {
  it('renders the nights read-only: cards visible, filter affordances hidden', () => {
    render(<SwipeDeck initial={[night('a', { title: 'Pottery + ramen' })]} userId="u1" canAct={false} />);
    // the night card renders fully (browse works)
    expect(screen.getByText(/pottery \+ ramen/i)).toBeInTheDocument();
    // filters are preference-driven — hidden until onboarding creates prefs
    expect(screen.queryByRole('group', { name: /quick filters/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^filters$/i })).not.toBeInTheDocument();
  });

  it('heart tap → verify prompt with an /onboarding CTA, NOT a swipe call', async () => {
    render(<SwipeDeck initial={[night('a'), night('b')]} userId="u1" canAct={false} />);
    await userEvent.click(screen.getAllByRole('button', { name: /interested/i })[0]);
    expect(recordSwipe).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledWith(
      expect.stringMatching(/verify to match on this night/i),
      expect.objectContaining({ action: expect.objectContaining({ label: 'verify me' }) }),
    );
    // the CTA routes into onboarding
    const opts = toastFn.mock.calls[0][1] as { action: { onClick: () => void } };
    opts.action.onClick();
    expect(routerPush).toHaveBeenCalledWith('/onboarding');
    // the card stays on top (nothing advanced, nothing persisted)
    expect(screen.getByText(/2 left/i)).toBeInTheDocument();
  });

  it('pass tap advances locally without recording a swipe (keep browsing)', async () => {
    render(<SwipeDeck initial={[night('a'), night('b')]} userId="u1" canAct={false} />);
    await userEvent.click(screen.getAllByRole('button', { name: /nope/i })[0]);
    expect(recordSwipe).not.toHaveBeenCalled();
    expect(screen.getByText(/1 left/i)).toBeInTheDocument();
  });

  it('interest from inside the detail sheet is gated the same way', async () => {
    render(<SwipeDeck initial={[night('a')]} userId="u1" canAct={false} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /tap to read the full plan/i }), { key: 'Enter' });
    const sheetButtons = await screen.findAllByRole('button', { name: /interested/i });
    await userEvent.click(sheetButtons[sheetButtons.length - 1]);
    expect(recordSwipe).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalled();
  });

  it('verified default (canAct omitted) still records swipes — behavior unchanged', async () => {
    render(<SwipeDeck initial={[night('a'), night('b')]} userId="u1" />);
    await userEvent.click(screen.getAllByRole('button', { name: /interested/i })[0]);
    await waitFor(() => expect(recordSwipe).toHaveBeenCalledWith(expect.anything(), 'a', 'right'));
    expect(toastFn).not.toHaveBeenCalled();
  });
});
