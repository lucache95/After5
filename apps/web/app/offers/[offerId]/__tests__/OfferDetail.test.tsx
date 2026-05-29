// apps/web/app/offers/[offerId]/__tests__/OfferDetail.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const acceptOffer = vi.fn();
const passOffer = vi.fn();
const withdraw = vi.fn();
vi.mock('@/lib/after5/match', () => ({
  acceptOffer: (...a: unknown[]) => acceptOffer(...a),
  passOffer: (...a: unknown[]) => passOffer(...a),
  withdraw: (...a: unknown[]) => withdraw(...a),
  MatchError: class extends Error { code: string; constructor(c: string) { super(c); this.code = c; } },
  messageForCode: (c: string) => c,
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) }) }));

import { OfferDetail, type OfferDetailProps } from '../OfferDetail';
import { MatchError } from '@/lib/after5/match';

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 10_000).toISOString();

function props(over: Partial<OfferDetailProps> = {}): OfferDetailProps {
  return {
    offerId: 'off-1',
    instanceId: 'inst-1',
    expiresAt: future,
    status: 'active',
    host: { first_name: 'Sam', age: 29, city: 'Portland', photo_url: null, bio: 'likes long walks.' },
    date: { startsAt: new Date('2026-06-01T19:00:00Z').toISOString() },
    ...over,
  };
}

beforeEach(() => {
  acceptOffer.mockReset();
  passOffer.mockReset();
  withdraw.mockReset();
  push.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe('OfferDetail', () => {
  it('renders host tier-3 lowercased + bio', () => {
    render(<OfferDetail {...props()} />);
    expect(screen.getByText(/sam, 29/i)).toBeInTheDocument();
    expect(screen.getByText(/portland/i)).toBeInTheDocument();
    expect(screen.getByText(/likes long walks/i)).toBeInTheDocument();
  });

  it('accept resolves a lock id and routes to /matches/<lock>', async () => {
    acceptOffer.mockResolvedValue('lock-7');
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/matches/lock-7'));
    expect(acceptOffer).toHaveBeenCalledWith('off-1');
  });

  it('pass routes to /feed', async () => {
    passOffer.mockResolvedValue(undefined);
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /^pass$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feed'));
    expect(passOffer).toHaveBeenCalledWith('off-1');
  });

  it('withdraw calls withdraw(instanceId) when instanceId is set', async () => {
    withdraw.mockResolvedValue(null);
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /not interested/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feed'));
    expect(withdraw).toHaveBeenCalledWith('inst-1');
    expect(passOffer).not.toHaveBeenCalled();
  });

  it('withdraw falls back to passOffer when instanceId is null', async () => {
    passOffer.mockResolvedValue(undefined);
    render(<OfferDetail {...props({ instanceId: null })} />);
    await userEvent.click(screen.getByRole('button', { name: /not interested/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feed'));
    expect(passOffer).toHaveBeenCalledWith('off-1');
    expect(withdraw).not.toHaveBeenCalled();
  });

  it('offer_expired error toasts and routes to /feed', async () => {
    acceptOffer.mockRejectedValue(new MatchError('offer_expired'));
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('offer_expired'));
    expect(push).toHaveBeenCalledWith('/feed');
  });

  it('account_gated error renders inline AccountGate and does not navigate', async () => {
    acceptOffer.mockRejectedValue(new MatchError('account_gated'));
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent(/can't take this offer/i));
    expect(push).not.toHaveBeenCalled();
  });

  it('expired prop disables accept + pass but leaves withdraw enabled', () => {
    render(<OfferDetail {...props({ expiresAt: past })} />);
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^pass$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /not interested/i })).toBeEnabled();
  });

  it('null date renders the unlock-on-accept placeholder', () => {
    render(<OfferDetail {...props({ date: null })} />);
    expect(screen.getByText(/details unlock when you accept/i)).toBeInTheDocument();
  });
});
