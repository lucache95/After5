// apps/web/app/dates/[instanceId]/interested/__tests__/InterestedList.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

const shortlist = vi.fn();
const rejectCandidate = vi.fn();
const withdraw = vi.fn();
vi.mock('@/lib/after5/match', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/after5/match')>('@/lib/after5/match');
  return {
    ...actual,
    shortlist: (...a: unknown[]) => shortlist(...a),
    rejectCandidate: (...a: unknown[]) => rejectCandidate(...a),
    withdraw: (...a: unknown[]) => withdraw(...a),
  };
});
const subscribeQueueInserts = vi.fn(() => () => {});
vi.mock('@/lib/after5/realtime', () => ({ subscribeQueueInserts: (...a: unknown[]) => subscribeQueueInserts(...a) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastPlain = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign((...a: unknown[]) => toastPlain(...a), { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) }) }));
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
// vaul renders into a portal; stub it to a plain inline container so the confirm
// sheet content is queryable when `open`.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Root = ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div>{children}</div> : null;
  return {
    Drawer: {
      Root,
      Portal: Pass,
      Overlay: () => null,
      Content: ({ children }: { children?: React.ReactNode }) => <div role="dialog">{children}</div>,
      Title: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
      Description: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
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

beforeEach(() => {
  shortlist.mockReset();
  rejectCandidate.mockReset();
  withdraw.mockReset();
  subscribeQueueInserts.mockClear();
  toastError.mockReset();
  toastSuccess.mockReset();
  toastPlain.mockReset();
});

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

  // ── E12 host triage (decline / withdraw / outcome pills) ───────────────────

  it('decline confirm calls rejectCandidate and removes the row silently', async () => {
    rejectCandidate.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<InterestedList {...base} candidates={[cand('b', 'interested', null)]} />);
    await user.click(screen.getByRole('button', { name: /pass on Nb/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^pass$/i }));
    await waitFor(() => expect(rejectCandidate).toHaveBeenCalledWith('inst-1', 'b'));
    // Optimistically removed: the candidate no longer renders.
    await waitFor(() => expect(screen.queryByText(/Nb/)).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/off your list/i));
    // SILENT (D-04): no candidate-facing rejection / notification copy anywhere.
    expect(screen.queryByText(/rejected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/notified|notification/i)).not.toBeInTheDocument();
  });

  it('rolls back and toasts when a decline write fails', async () => {
    rejectCandidate.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    render(<InterestedList {...base} candidates={[cand('b', 'interested', null)]} />);
    await user.click(screen.getByRole('button', { name: /pass on Nb/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^pass$/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // Row restored — its add-to-shortlist control is back.
    expect(screen.getByRole('button', { name: /add Nb to shortlist/i })).toBeInTheDocument();
  });

  it('withdraw confirm calls withdraw(instance) on the active-offer row', async () => {
    withdraw.mockResolvedValue(null);
    const user = userEvent.setup();
    render(
      <InterestedList
        {...base}
        activeOffer={{ candidate_id: 'a' }}
        candidates={[cand('a', 'offer_active', 1)]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /pull the offer back from Na/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /pull it/i }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('inst-1'));
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/offer pulled/i));
  });

  it('filters passed_by_host candidates out of both sections', () => {
    render(
      <InterestedList
        {...base}
        candidates={[cand('a', 'shortlisted', 1), cand('p', 'passed_by_host', null), cand('q', 'passed_by_host', 2)]}
      />,
    );
    expect(screen.queryByText(/Np/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nq/)).not.toBeInTheDocument();
  });

  it('renders the correct outcome pill per status', () => {
    render(
      <InterestedList
        {...base}
        activeOffer={{ candidate_id: 'a' }}
        candidates={[
          cand('a', 'offer_active', 1),
          cand('l', 'locked', 2),
          cand('p', 'offer_passed', 3),
          cand('e', 'offer_expired', 4),
        ]}
      />,
    );
    expect(screen.getByText(/offer out/i)).toBeInTheDocument();
    expect(screen.getByText(/^accepted$/i)).toBeInTheDocument();
    expect(screen.getByText(/they passed/i)).toBeInTheDocument();
    expect(screen.getByText(/^expired$/i)).toBeInTheDocument();
  });

  it('has no a11y violations with the full triage UI rendered', async () => {
    const { container } = render(
      <InterestedList
        {...base}
        candidates={[cand('a', 'shortlisted', 1), cand('b', 'interested', null)]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
