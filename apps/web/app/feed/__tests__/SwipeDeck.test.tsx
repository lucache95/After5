import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const recordSwipe = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}), recordSwipe: (...a: unknown[]) => recordSwipe(...a) }));
import { SwipeDeck } from '../SwipeDeck';
const night = (id: string) => ({ date_instance_id: id, city_id: 'c', time_window_start: new Date(Date.now()+86400000).toISOString(), itinerary_id: 'i', pay_setting: null, vibe_tags: [], why_note: 'w', cover_image_url: null, title: 'T', venue_neighborhood: null, is_seed: false, distance_m: 1000 });

beforeEach(() => recordSwipe.mockClear());

describe('SwipeDeck', () => {
  it('empty: shows the dry end-of-deck copy when no nights', () => {
    render(<SwipeDeck initial={[]} />);
    expect(screen.getByText(/that.s everyone for now/i)).toBeInTheDocument();
    expect(screen.getByText(/touch grass/i)).toBeInTheDocument();
  });
  it('swipe right records and advances to the next card', async () => {
    render(<SwipeDeck initial={[night('a'), night('b')]} />);
    await userEvent.click(screen.getByRole('button', { name: /interested/i }));
    await waitFor(() => expect(recordSwipe).toHaveBeenCalledWith(expect.anything(), 'a', 'right'));
  });
});
