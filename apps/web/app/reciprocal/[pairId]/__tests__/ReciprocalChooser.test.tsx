import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const resolveReciprocal = vi.fn();
vi.mock('@/lib/after5/match', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/after5/match')>('@/lib/after5/match');
  return { ...actual, resolveReciprocal: (...a: unknown[]) => resolveReciprocal(...a) };
});
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ReciprocalChooser } from '../ReciprocalChooser';
import { MatchError } from '@/lib/after5/match';

const inst = (id: string, title: string) => ({ id, title, starts_at: new Date(Date.now() + 86400000).toISOString(), cover_image_url: null });

beforeEach(() => { resolveReciprocal.mockReset(); push.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); });

describe('ReciprocalChooser', () => {
  it('renders both instances', () => {
    render(<ReciprocalChooser pairId="pair-1" instanceA={inst('a', 'jazz bar')} instanceB={inst('b', 'pottery')} />);
    expect(screen.getByText(/jazz bar/i)).toBeInTheDocument();
    expect(screen.getByText(/pottery/i)).toBeInTheDocument();
  });

  it('picking calls resolveReciprocal and redirects to the chosen list', async () => {
    resolveReciprocal.mockResolvedValue(null);
    render(<ReciprocalChooser pairId="pair-1" instanceA={inst('a', 'jazz bar')} instanceB={inst('b', 'pottery')} />);
    await userEvent.click(screen.getByRole('button', { name: /keep jazz bar/i }));
    await waitFor(() => expect(resolveReciprocal).toHaveBeenCalledWith('pair-1', 'a'));
    expect(push).toHaveBeenCalledWith('/dates/a/interested');
  });

  it('reciprocal_stale toasts both-cancelled and redirects home', async () => {
    resolveReciprocal.mockRejectedValue(new MatchError('reciprocal_stale', 'P5009'));
    render(<ReciprocalChooser pairId="pair-1" instanceA={inst('a', 'jazz bar')} instanceB={inst('b', 'pottery')} />);
    await userEvent.click(screen.getByRole('button', { name: /keep pottery/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/both dates were cancelled/i)));
    expect(push).toHaveBeenCalledWith('/home');
  });
});
