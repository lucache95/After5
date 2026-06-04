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
// next/image renders nothing useful in jsdom (and `fill` warns); stub to a plain img.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));

import { OfferDetail, type OfferDetailProps } from '../OfferDetail';
import { MatchError } from '@/lib/after5/match';
import type { NightDetailStop } from '@/lib/after5/client';

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 10_000).toISOString();

function stop(over: Partial<NightDetailStop>): NightDetailStop {
  return {
    name: 'a spot', type: null, start_time: null, duration_min: null,
    cost_pp: null, what_to_do: null, neighborhood: null, local_insight: null,
    photo_url: null, lat: null, lng: null, drive_to_next_min: null,
    ...over,
  };
}

function props(over: Partial<OfferDetailProps> = {}): OfferDetailProps {
  return {
    offerId: 'off-1',
    instanceId: 'inst-1',
    expiresAt: future,
    status: 'active',
    host: { first_name: 'Sam', age: 29, city: 'Portland', photo_url: null },
    date: { startsAt: new Date('2026-06-01T19:00:00Z').toISOString() },
    stops: [],
    vibeTags: ['chill'],
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
  it('renders host tier-3 lowercased (no bio — F#5 removed)', () => {
    render(<OfferDetail {...props()} />);
    expect(screen.getByText(/sam, 29/i)).toBeInTheDocument();
    expect(screen.getByText(/portland/i)).toBeInTheDocument();
  });

  it('renders the matched plan stops via PlanTimeline in "the night"', () => {
    render(<OfferDetail {...props({ stops: [
      stop({ name: 'rooftop bar', cost_pp: 22 }),
      stop({ name: 'late-night ramen', cost_pp: 0 }),
    ] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText('rooftop bar')).toBeInTheDocument();
    expect(screen.getByText('late-night ramen')).toBeInTheDocument();
  });

  it('shows the degrade copy when stops are empty (never a blank labelled section)', () => {
    render(<OfferDetail {...props({ stops: [] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText('the full plan unlocks here.')).toBeInTheDocument();
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
