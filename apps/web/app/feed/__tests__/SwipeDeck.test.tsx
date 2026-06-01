import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const recordSwipe = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}), recordSwipe: (...a: unknown[]) => recordSwipe(...a) }));
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
const base = (id: string) => ({ date_instance_id: id, city_id: 'c', time_window_start: new Date(Date.now()+86400000).toISOString(), itinerary_id: 'i', pay_setting: null, vibe_tags: [] as string[], why_note: 'w', cover_image_url: null, title: 'T', venue_neighborhood: null, is_seed: false, distance_m: 1000 });

beforeEach(() => recordSwipe.mockClear());

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
    // Reassurance copy is present...
    expect(await screen.findByText(/who.s hosting stays a secret until you both match/i)).toBeInTheDocument();
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
