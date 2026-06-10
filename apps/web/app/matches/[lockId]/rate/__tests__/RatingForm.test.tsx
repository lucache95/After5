import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const submitRating = vi.fn();
vi.mock('@/lib/after5/match', () => ({
  submitRating: (...a: unknown[]) => submitRating(...a),
  MatchError: class extends Error { code: string; constructor(c: string) { super(c); this.code = c; } },
  messageForCode: (c: string) => c,
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const toastFn = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign((...a: unknown[]) => toastFn(...a), { error: (...a: unknown[]) => toastError(...a) }) }));

import { RatingForm } from '../RatingForm';
import { MatchError } from '@/lib/after5/match';

beforeEach(() => { submitRating.mockReset(); push.mockReset(); toastFn.mockReset(); toastError.mockReset(); });

describe('RatingForm', () => {
  it('renders the consequence-transparency line near the submit button', () => {
    render(<RatingForm lockId="lock-1" rateeId="them" />);
    expect(screen.getByText(/your answers shape their reliability badge/i)).toBeInTheDocument();
  });

  it('toggles default to null and submits selected booleans', async () => {
    submitRating.mockResolvedValue('ok');
    render(<RatingForm lockId="lock-1" rateeId="them" />);
    // answer "did they show up?" -> yes, "were they on time?" -> no
    const showedUp = screen.getByRole('group', { name: /did they show up/i });
    await userEvent.click(within(showedUp).getByRole('radio', { name: 'yes' }));
    const onTime = screen.getByRole('group', { name: /were they on time/i });
    await userEvent.click(within(onTime).getByRole('radio', { name: 'no' }));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(submitRating).toHaveBeenCalledWith({
      lockId: 'lock-1', rateeId: 'them',
      showed_up: true, on_time: false, cancelled_with_notice: null, unsafe_or_disrespectful: null,
    }));
  });

  it('ok result toasts success and navigates back to the lock', async () => {
    submitRating.mockResolvedValue('ok');
    render(<RatingForm lockId="lock-1" rateeId="them" />);
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/matches/lock-1'));
    expect(toastFn).toHaveBeenCalled();
  });

  it('already_rated result shows the terminal "already rated" copy', async () => {
    submitRating.mockResolvedValue('already_rated');
    render(<RatingForm lockId="lock-1" rateeId="them" />);
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/already rated this date/i)).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });

  it('thrown MatchError toasts the mapped error', async () => {
    submitRating.mockRejectedValue(new MatchError('server_error'));
    render(<RatingForm lockId="lock-1" rateeId="them" />);
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('server_error'));
  });
});
