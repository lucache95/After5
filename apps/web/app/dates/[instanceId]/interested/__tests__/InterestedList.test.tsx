// apps/web/app/dates/[instanceId]/interested/__tests__/InterestedList.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const shortlist = vi.fn();
vi.mock('@/lib/after5/match', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/after5/match')>('@/lib/after5/match');
  return { ...actual, shortlist: (...a: unknown[]) => shortlist(...a) };
});
const subscribeQueueInserts = vi.fn(() => () => {});
vi.mock('@/lib/after5/realtime', () => ({ subscribeQueueInserts: (...a: unknown[]) => subscribeQueueInserts(...a) }));
const toastError = vi.fn();
const toastPlain = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign((...a: unknown[]) => toastPlain(...a), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));
// Reorder.Group/Item render their children inline; stub framer-motion's reorder API.
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return {
    ...actual,
    Reorder: {
      Group: ({ children }: { children?: React.ReactNode }) => <ul>{children}</ul>,
      Item: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
    },
  };
});
// MakeOfferModal is covered by its own test; stub so this test stays focused.
vi.mock('../MakeOfferModal', () => ({ MakeOfferModal: () => <div data-testid="offer-modal" /> }));

import { InterestedList } from '../InterestedList';

const cand = (id: string, status: string, rank: number | null) => ({
  candidate_id: id, status, rank, first_name: `N${id}`, age: 26, city: 'portland',
  photo_url: null, can_enter_lock_flow: true,
});

beforeEach(() => { shortlist.mockReset(); subscribeQueueInserts.mockClear(); toastError.mockReset(); toastPlain.mockReset(); });

const base = {
  instanceId: 'inst-1', userId: 'host-1', offerWindowHours: 24,
  activeOffer: null as null | { candidate_id: string },
};

describe('InterestedList', () => {
  it('renders shortlist and new-interest sections', () => {
    render(<InterestedList {...base} candidates={[cand('a', 'shortlisted', 1), cand('b', 'interested', null)]} />);
    expect(screen.getByRole('heading', { name: /shortlist/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new interest/i })).toBeInTheDocument();
  });

  it('add-to-shortlist calls match-shortlist with rank = shortlist length + 1', async () => {
    shortlist.mockResolvedValue(null);
    render(<InterestedList {...base} candidates={[cand('a', 'shortlisted', 1), cand('b', 'interested', null)]} />);
    await userEvent.click(screen.getByRole('button', { name: /add Nb to shortlist/i }));
    await waitFor(() => expect(shortlist).toHaveBeenCalledWith('inst-1', 'b', 2));
  });

  it('rolls back and toasts when a shortlist write fails', async () => {
    shortlist.mockRejectedValue(new Error('nope'));
    render(<InterestedList {...base} candidates={[cand('a', 'shortlisted', 1), cand('b', 'interested', null)]} />);
    await userEvent.click(screen.getByRole('button', { name: /add Nb to shortlist/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // b returns to the new-interest section (still has its add button).
    expect(screen.getByRole('button', { name: /add Nb to shortlist/i })).toBeInTheDocument();
  });

  it('shows the make-offer CTA only on rank-1 and hides it while an offer is active', () => {
    const { rerender } = render(<InterestedList {...base} candidates={[cand('a', 'shortlisted', 1), cand('c', 'shortlisted', 2)]} />);
    expect(screen.getByRole('button', { name: /make offer to Na/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make offer to Nc/i })).not.toBeInTheDocument();
    rerender(<InterestedList {...base} activeOffer={{ candidate_id: 'a' }} candidates={[cand('a', 'offer_active', 1), cand('c', 'shortlisted', 2)]} />);
    expect(screen.queryByRole('button', { name: /make offer/i })).not.toBeInTheDocument();
    expect(screen.getByText(/offer out/i)).toBeInTheDocument();
  });

  it('mutes a candidate who is already booked elsewhere', async () => {
    const booked = { ...cand('d', 'interested', null), can_enter_lock_flow: false };
    render(<InterestedList {...base} candidates={[booked]} />);
    const row = screen.getByRole('button', { name: /Nd is already booked/i });
    await userEvent.click(row);
    expect(toastPlain).toHaveBeenCalledWith(expect.stringMatching(/already booked/i));
  });

  it('subscribes to user-scoped queue inserts on mount', () => {
    render(<InterestedList {...base} candidates={[cand('a', 'shortlisted', 1)]} />);
    expect(subscribeQueueInserts).toHaveBeenCalledWith('host-1', 'inst-1', expect.any(Function));
  });

  it('shows load-more when the initial page is full (20)', () => {
    const many = Array.from({ length: 20 }, (_, i) => cand(`i${i}`, 'interested', null));
    render(<InterestedList {...base} candidates={many} />);
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });
});
